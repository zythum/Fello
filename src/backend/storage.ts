import { basename, join } from "path";
import { homedir } from "os";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
  appendFileSync,
} from "fs";
import { createHash } from "crypto";
import type {
  ProjectInfo,
  SessionInfo,
  SettingsInfo,
  SessionNotificationFelloExt,
} from "../shared/schema";
import type {
  SessionModelState,
  SessionModeState,
  InitializeResponse,
} from "@agentclientprotocol/sdk";

export const FELLO_DIR = join(homedir(), ".fello");
export const PROJECTS_DIR = join(FELLO_DIR, "projects");

interface SettingsMeta {
  agents: {
    [id: string]: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
  theme: {
    theme_mode: "light" | "dark" | "system";
  };
  i18n: {
    language: string;
  };
  mcpServers: {
    [id: string]: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
}

const DEFAULT_SETTINGS: SettingsMeta = {
  agents: {},
  theme: { theme_mode: "system" },
  i18n: {
    language: "en",
  },
  mcpServers: {},
};

interface ProjectMeta {
  id: string;
  title: string;
  cwd: string;
  created_at: number;
}

interface SessionMeta {
  id: string;
  title: string;
  agent_id: string;
  resume_id: string;
  project_id: string;
  created_at: number;
  updated_at: number;
  mcp_servers?: string[];
  models?: SessionModelState | null;
  modes?: SessionModeState | null;
  initialize_info?: InitializeResponse | null;
}

mkdirSync(PROJECTS_DIR, { recursive: true });

function settingsPath() {
  return join(FELLO_DIR, "settings.json");
}

function readSettings(): SettingsMeta {
  try {
    if (!existsSync(settingsPath())) return DEFAULT_SETTINGS;
    const raw: unknown = JSON.parse(readFileSync(settingsPath(), "utf-8"));

    const isObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);

    const rawObj = isObject(raw) ? raw : null;
    const rawAgents = rawObj && isObject(rawObj.agents) ? rawObj.agents : null;

    const agents: SettingsMeta["agents"] = (() => {
      if (!rawAgents) return DEFAULT_SETTINGS.agents;
      const next: SettingsMeta["agents"] = {};
      for (const [id, value] of Object.entries(rawAgents)) {
        const cfg = isObject(value) ? value : null;
        const command = typeof cfg?.command === "string" ? cfg.command : "";
        const args = Array.isArray(cfg?.args) ? cfg.args.filter((v) => typeof v === "string") : [];
        const env = (() => {
          if (!isObject(cfg?.env)) return {};
          const nextEnv: Record<string, string> = {};
          for (const [k, v] of Object.entries(cfg.env)) {
            nextEnv[k] = String(v);
          }
          return nextEnv;
        })();

        next[id] = { command, args, env };
      }
      return next;
    })();

    const theme =
      rawObj && isObject(rawObj.theme) && rawObj.theme.theme_mode
        ? {
            theme_mode:
              rawObj.theme.theme_mode === "light" ||
              rawObj.theme.theme_mode === "dark" ||
              rawObj.theme.theme_mode === "system"
                ? rawObj.theme.theme_mode
                : DEFAULT_SETTINGS.theme.theme_mode,
          }
        : DEFAULT_SETTINGS.theme;

    const i18n =
      rawObj && isObject(rawObj.i18n) && typeof rawObj.i18n.language === "string"
        ? { language: rawObj.i18n.language }
        : DEFAULT_SETTINGS.i18n;

    const rawMcpServers = rawObj && isObject(rawObj.mcpServers) ? rawObj.mcpServers : null;
    const mcpServers: SettingsMeta["mcpServers"] = (() => {
      if (!rawMcpServers) return DEFAULT_SETTINGS.mcpServers;
      const next: SettingsMeta["mcpServers"] = {};
      for (const [id, value] of Object.entries(rawMcpServers)) {
        const cfg = isObject(value) ? value : null;
        const command = typeof cfg?.command === "string" ? cfg.command : "";
        const args = Array.isArray(cfg?.args) ? cfg.args.filter((v) => typeof v === "string") : [];
        const env = (() => {
          if (!isObject(cfg?.env)) return {};
          const nextEnv: Record<string, string> = {};
          for (const [k, v] of Object.entries(cfg.env)) {
            nextEnv[k] = String(v);
          }
          return nextEnv;
        })();
        next[id] = { command, args, env };
      }
      return next;
    })();

    return { agents, theme, i18n, mcpServers };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(meta: SettingsMeta) {
  writeFileSync(settingsPath(), JSON.stringify(meta, null, 2));
}

function hashCwd(cwd: string) {
  return createHash("sha1").update(cwd.trim()).digest("hex");
}

function projectDir(projectId: string) {
  return join(PROJECTS_DIR, projectId);
}

function projectMetaPath(projectId: string) {
  return join(projectDir(projectId), "project.json");
}

function projectSessionsDir(projectId: string) {
  return join(projectDir(projectId), "sessions");
}

function sessionDir(projectId: string, sessionId: string) {
  return join(projectSessionsDir(projectId), sessionId);
}

function sessionMetaPath(projectId: string, sessionId: string) {
  return join(sessionDir(projectId, sessionId), "session.json");
}

function readProjectMeta(projectId: string): ProjectMeta | null {
  try {
    const raw: ProjectMeta = JSON.parse(readFileSync(projectMetaPath(projectId), "utf-8"));
    if (!raw) return null;
    const id = String(raw.id || "");
    const title = String(raw.title || "");
    const cwd = String(raw.cwd || "");
    const created_at =
      typeof raw.created_at === "number" ? raw.created_at : Math.floor(Date.now() / 1000);
    if (!id || !title || !cwd) return null;
    return { id, title, cwd, created_at };
  } catch {
    return null;
  }
}

function writeProjectMeta(meta: ProjectMeta) {
  mkdirSync(projectDir(meta.id), { recursive: true });
  mkdirSync(projectSessionsDir(meta.id), { recursive: true });
  writeFileSync(projectMetaPath(meta.id), JSON.stringify(meta, null, 2));
}

function readSessionMeta(projectId: string, sessionId: string): SessionMeta | null {
  try {
    const raw: SessionMeta = JSON.parse(
      readFileSync(sessionMetaPath(projectId, sessionId), "utf-8"),
    );
    if (!raw) return null;
    const id = String(raw.id);
    const title = String(raw.title || "");
    const agent_id = String(raw.agent_id);
    const resume_id = String(raw.resume_id);
    const project_id = String(raw.project_id);
    const created_at =
      typeof raw.created_at === "number" ? raw.created_at : Math.floor(Date.now() / 1000);
    const updated_at = typeof raw.updated_at === "number" ? raw.updated_at : created_at;
    const mcp_servers = Array.isArray(raw.mcp_servers)
      ? raw.mcp_servers.filter((v) => typeof v === "string")
      : undefined;
    const models = raw.models ?? null;
    const modes = raw.modes ?? null;
    const initialize_info = raw.initialize_info ?? null;
    if (!id || !agent_id || !resume_id || !project_id) return null;
    return {
      id,
      title,
      agent_id,
      resume_id,
      project_id,
      created_at,
      updated_at,
      mcp_servers,
      models,
      modes,
      initialize_info,
    };
  } catch {
    return null;
  }
}

function writeSessionMeta(meta: SessionMeta) {
  mkdirSync(sessionDir(meta.project_id, meta.id), { recursive: true });
  writeFileSync(sessionMetaPath(meta.project_id, meta.id), JSON.stringify(meta, null, 2));
}

function listProjectMetas() {
  if (!existsSync(PROJECTS_DIR)) return [];
  const dirs = readdirSync(PROJECTS_DIR);
  const projects: ProjectMeta[] = [];
  for (const dir of dirs) {
    const project = readProjectMeta(dir);
    if (project) projects.push(project);
  }
  projects.sort((a, b) => b.created_at - a.created_at);
  return projects;
}

function listSessionMetasByProject(projectId: string) {
  const sessionsPath = projectSessionsDir(projectId);
  if (!existsSync(sessionsPath)) return [];
  const dirs = readdirSync(sessionsPath);
  const sessions: SessionMeta[] = [];
  for (const dir of dirs) {
    const session = readSessionMeta(projectId, dir);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => b.updated_at - a.updated_at);
  return sessions;
}

export const storageOps = {
  getSettings(): SettingsInfo {
    const meta = readSettings();
    return {
      agents: Object.entries(meta.agents).map(([id, agentMeta]) => {
        return {
          id,
          command: agentMeta.command,
          args: agentMeta.args.slice(),
          env: Object.assign({}, agentMeta.env),
        };
      }),
      mcpServers: Object.entries(meta.mcpServers).map(([id, srvMeta]) => {
        return {
          id,
          command: srvMeta.command,
          args: srvMeta.args.slice(),
          env: Object.assign({}, srvMeta.env),
        };
      }),
      i18n: {
        language: meta.i18n.language,
      },
      theme: {
        themeMode: meta.theme.theme_mode,
      },
    };
  },

  updateSettings(settings: Partial<SettingsInfo>): void {
    const prevMeta = readSettings();
    const meta: SettingsMeta = {
      agents: (() => {
        if (!settings.agents) {
          return prevMeta.agents;
        }
        const nextAgents: SettingsMeta["agents"] = {};
        for (const agent of settings.agents) {
          nextAgents[agent.id] = {
            command: agent.command,
            args: agent.args.slice(),
            env: Object.assign({}, agent.env),
          };
        }
        return nextAgents;
      })(),
      i18n: (() => {
        if (!settings.i18n) {
          return prevMeta.i18n;
        }
        return {
          language: settings.i18n.language,
        };
      })(),
      theme: (() => {
        if (!settings.theme) {
          return prevMeta.theme;
        }
        return {
          theme_mode: settings.theme.themeMode,
        };
      })(),
      mcpServers: (() => {
        if (!settings.mcpServers) {
          return prevMeta.mcpServers;
        }
        const nextMcpServers: SettingsMeta["mcpServers"] = {};
        for (const srv of settings.mcpServers) {
          nextMcpServers[srv.id] = {
            command: srv.command,
            args: srv.args.slice(),
            env: Object.assign({}, srv.env),
          };
        }
        return nextMcpServers;
      })(),
    };
    writeSettings(meta);
  },

  listProjects(): ProjectInfo[] {
    return listProjectMetas().map((p) => ({
      id: p.id,
      title: p.title,
      cwd: p.cwd,
      createdAt: p.created_at,
    }));
  },

  addProject(cwd: string) {
    const projectId = hashCwd(cwd);
    const existing = readProjectMeta(projectId);
    if (existing) {
      return {
        project: {
          id: existing.id,
          title: existing.title,
          cwd: existing.cwd,
          createdAt: existing.created_at,
        },
        created: false,
      };
    }
    const now = Math.floor(Date.now() / 1000);
    const title = basename(cwd) || cwd;
    const meta: ProjectMeta = { id: projectId, title, cwd, created_at: now };
    writeProjectMeta(meta);
    return {
      project: {
        id: meta.id,
        title: meta.title,
        cwd: meta.cwd,
        createdAt: meta.created_at,
      },
      created: true,
    };
  },

  updateProjectTitle(projectId: string, title: string) {
    const project = readProjectMeta(projectId);
    if (!project) return;
    const nextTitle = title.trim();
    if (!nextTitle) return;
    project.title = nextTitle;
    writeProjectMeta(project);
  },

  deleteProject(projectId: string) {
    const dir = projectDir(projectId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  },

  getProject(projectId: string): ProjectInfo | null {
    const project = readProjectMeta(projectId);
    if (!project) return null;
    return {
      id: project.id,
      title: project.title,
      cwd: project.cwd,
      createdAt: project.created_at,
    };
  },

  createSession(
    projectId: string,
    resumeId: string,
    agentId: string,
    updates?: Partial<{
      title: string;
      mcpServers: string[];
      models: SessionModelState | null;
      modes: SessionModeState | null;
      initializeInfo: InitializeResponse | null;
    }>,
  ) {
    const project = readProjectMeta(projectId);
    if (!project) throw new Error("Project does not exist");
    const now = Math.floor(Date.now() / 1000);
    const id = `${agentId}:${resumeId}`;
    writeSessionMeta({
      id: id,
      title: updates?.title ?? "",
      agent_id: agentId,
      resume_id: resumeId,
      project_id: projectId,
      created_at: now,
      updated_at: now,
      mcp_servers: updates?.mcpServers ?? [],
      models: updates?.models ?? null,
      modes: updates?.modes ?? null,
      initialize_info: updates?.initializeInfo ?? null,
    });
    return id;
  },

  updateSession(
    id: string,
    updates: Partial<{
      title: string;
      mcpServers: string[];
      models: SessionModelState | null;
      modes: SessionModeState | null;
      initializeInfo: InitializeResponse | null;
    }>,
  ) {
    const session = this.getSession(id);
    if (!session) return;
    const meta = readSessionMeta(session.projectId, session.id);
    if (!meta) return;

    if (updates.title !== undefined) meta.title = updates.title;
    if (updates.mcpServers !== undefined) meta.mcp_servers = updates.mcpServers;
    if (updates.models !== undefined) meta.models = updates.models;
    if (updates.modes !== undefined) meta.modes = updates.modes;
    if (updates.initializeInfo !== undefined) meta.initialize_info = updates.initializeInfo;

    meta.updated_at = Math.floor(Date.now() / 1000);
    writeSessionMeta(meta);
  },

  deleteSession(id: string) {
    const session = this.getSession(id);
    if (!session) return;
    const dir = sessionDir(session.projectId, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  },

  listSessions(): SessionInfo[] {
    const projects = listProjectMetas();
    const sessions: SessionInfo[] = [];
    for (const project of projects) {
      const byProject = listSessionMetasByProject(project.id);
      for (const session of byProject) {
        sessions.push({
          id: session.id,
          title: session.title,
          cwd: project.cwd,
          projectId: session.project_id,
          projectTitle: project.title,
          agentId: session.agent_id,
          resumeId: session.resume_id,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          mcpServers: session.mcp_servers ?? [],
          models: session.models ?? null,
          modes: session.modes ?? null,
          initializeInfo: session.initialize_info ?? null,
        });
      }
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions;
  },

  getSession(id: string): SessionInfo | null {
    const projects = listProjectMetas();
    for (const project of projects) {
      const meta = readSessionMeta(project.id, id);
      if (!meta) continue;
      return {
        id: meta.id,
        title: meta.title,
        cwd: project.cwd,
        projectId: meta.project_id,
        projectTitle: project.title,
        agentId: meta.agent_id,
        resumeId: meta.resume_id,
        createdAt: meta.created_at,
        updatedAt: meta.updated_at,
        mcpServers: meta.mcp_servers ?? [],
        models: meta.models ?? null,
        modes: meta.modes ?? null,
        initializeInfo: meta.initialize_info ?? null,
      };
    }
    return null;
  },

  touchSession(id: string) {
    const session = this.getSession(id);
    if (!session) return;
    const meta = readSessionMeta(session.projectId, session.id);
    if (!meta) return;
    meta.updated_at = Math.floor(Date.now() / 1000);
    writeSessionMeta(meta);
  },

  appendSessionMessage(id: string, notification: SessionNotificationFelloExt) {
    const session = this.getSession(id);
    if (!session) return;
    const filePath = join(sessionDir(session.projectId, id), "messages.jsonl");
    appendFileSync(filePath, JSON.stringify(notification) + "\n");
  },

  readSessionMessages(id: string): SessionNotificationFelloExt[] {
    const session = this.getSession(id);
    if (!session) return [];
    const filePath = join(sessionDir(session.projectId, id), "messages.jsonl");
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as SessionNotificationFelloExt[];
  },
};

export default storageOps;
