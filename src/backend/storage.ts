import { basename, join } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";
import { createHash } from "crypto";

const DATA_DIR = join(homedir(), ".fello");
const PROJECTS_DIR = join(DATA_DIR, "projects");
mkdirSync(PROJECTS_DIR, { recursive: true });

export interface AgentConfig {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ThemeConfig {
  theme_mode: "light" | "dark" | "system";
}

export interface SettingsMeta {
  agents: AgentConfig[];
  theme?: ThemeConfig;
  language?: string;
}

export const DEFAULT_SETTINGS: SettingsMeta = {
  agents: [],
  theme: { theme_mode: "system" },
  language: "en",
};

function settingsPath() {
  return join(DATA_DIR, "settings.json");
}

function readSettings(): SettingsMeta {
  try {
    if (!existsSync(settingsPath())) return DEFAULT_SETTINGS;
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8"));
    const agents = Array.isArray(raw.agents)
      ? raw.agents.map((a: any) => {
          // migration from old format
          if (typeof a.command === "string" && !a.args) {
            const parts = a.command.trim().split(/\s+/);
            return {
              ...a,
              command: parts[0] || "",
              args: parts.slice(1),
              env: a.env || {},
            };
          }
          return {
            ...a,
            command: a.command || "",
            args: Array.isArray(a.args) ? a.args : [],
            env: a.env || {},
          };
        })
      : DEFAULT_SETTINGS.agents;
    const theme = raw.theme?.theme_mode
      ? { theme_mode: raw.theme.theme_mode }
      : DEFAULT_SETTINGS.theme;
    const language = typeof raw.language === "string" ? raw.language : DEFAULT_SETTINGS.language;
    return { agents, theme, language };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: SettingsMeta) {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

interface ProjectMeta {
  uuid: string;
  title: string;
  cwd: string;
  created_at: number;
}

interface SessionMeta {
  uuid: string;
  title: string;
  agent: string;
  session_id: string;
  project_uuid: string;
  command: string;
  created_at: number;
  updated_at: number;
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
    const raw = JSON.parse(readFileSync(projectMetaPath(projectId), "utf-8")) as Record<
      string,
      unknown
    > | null;
    if (!raw) return null;
    const uuid = String(raw.uuid || '');
    const title = String(raw.title || '');
    const cwd = String(raw.cwd || '');
    const created_at =
      typeof raw.created_at === "number" ? raw.created_at : Math.floor(Date.now() / 1000);
    if (!uuid || !title || !cwd) return null;
    return { uuid, title, cwd, created_at };
  } catch {
    return null;
  }
}

function writeProjectMeta(meta: ProjectMeta) {
  mkdirSync(projectDir(meta.uuid), { recursive: true });
  mkdirSync(projectSessionsDir(meta.uuid), { recursive: true });
  writeFileSync(projectMetaPath(meta.uuid), JSON.stringify(meta, null, 2));
}

function readSessionMeta(projectId: string, sessionId: string): SessionMeta | null {
  try {
    const raw = JSON.parse(readFileSync(sessionMetaPath(projectId, sessionId), "utf-8")) as Record<
      string,
      unknown
    > | null;
    if (!raw) return null;
    const uuid = String(raw.uuid);
    const title = String(raw.title || "");
    const agent = String(raw.agent);
    const session_id = String(raw.session_id);
    const project_uuid = String(raw.project_uuid);
    const command = String(raw.command);
    const created_at =
      typeof raw.created_at === "number" ? raw.created_at : Math.floor(Date.now() / 1000);
    const updated_at = typeof raw.updated_at === "number" ? raw.updated_at : created_at;
    if (!uuid || !session_id || !project_uuid) return null;
    return { uuid, title, agent, session_id, project_uuid, command, created_at, updated_at };
  } catch {
    return null;
  }
}

function writeSessionMeta(meta: SessionMeta) {
  mkdirSync(sessionDir(meta.project_uuid, meta.uuid), { recursive: true });
  writeFileSync(sessionMetaPath(meta.project_uuid, meta.uuid), JSON.stringify(meta, null, 2));
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
  getSettings() {
    return readSettings();
  },

  updateSettings(settings: SettingsMeta) {
    writeSettings(settings);
  },

  listProjects() {
    return listProjectMetas().map((p) => ({
      id: p.uuid,
      title: p.title,
      cwd: p.cwd,
      created_at: p.created_at,
    }));
  },

  addProject(cwd: string) {
    const projectId = hashCwd(cwd);
    const existing = readProjectMeta(projectId);
    if (existing) {
      return {
        project: {
          id: existing.uuid,
          title: existing.title,
          cwd: existing.cwd,
          created_at: existing.created_at,
        },
        created: false,
      };
    }
    const now = Math.floor(Date.now() / 1000);
    const title = basename(cwd) || cwd;
    const meta: ProjectMeta = { uuid: projectId, title, cwd, created_at: now };
    writeProjectMeta(meta);
    return {
      project: {
        id: meta.uuid,
        title: meta.title,
        cwd: meta.cwd,
        created_at: meta.created_at,
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

  getProject(projectId: string) {
    const project = readProjectMeta(projectId);
    if (!project) return null;
    return {
      id: project.uuid,
      title: project.title,
      cwd: project.cwd,
      created_at: project.created_at,
    };
  },

  createSession(projectId: string, acpSessionId: string, command: string, agent: string) {
    const project = readProjectMeta(projectId);
    if (!project) throw new Error("Project does not exist");
    const now = Math.floor(Date.now() / 1000);
    const id = `${agent}:${acpSessionId}`;
    writeSessionMeta({
      uuid: id,
      title: "New Chat",
      agent,
      session_id: acpSessionId,
      project_uuid: projectId,
      command,
      created_at: now,
      updated_at: now,
    });
    return id;
  },

  updateSessionTitle(id: string, title: string) {
    const session = this.getSession(id);
    if (!session) return;
    const meta = readSessionMeta(session.project_id, session.id);
    if (!meta) return;
    meta.title = title;
    meta.updated_at = Math.floor(Date.now() / 1000);
    writeSessionMeta(meta);
  },

  deleteSession(id: string) {
    const session = this.getSession(id);
    if (!session) return;
    const dir = sessionDir(session.project_id, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  },

  listSessions() {
    const projects = listProjectMetas();
    const sessions = [];
    for (const project of projects) {
      const byProject = listSessionMetasByProject(project.uuid);
      for (const session of byProject) {
        sessions.push({
          id: session.uuid,
          title: session.title,
          cwd: project.cwd,
          project_id: session.project_uuid,
          project_title: project.title,
          agent: session.agent,
          acp_session_id: session.session_id,
          agent_command: session.command,
          created_at: session.created_at,
          updated_at: session.updated_at,
        });
      }
    }
    sessions.sort((a, b) => b.updated_at - a.updated_at);
    return sessions;
  },

  getSession(id: string) {
    const projects = listProjectMetas();
    for (const project of projects) {
      const meta = readSessionMeta(project.uuid, id);
      if (!meta) continue;
      return {
        id: meta.uuid,
        title: meta.title,
        cwd: project.cwd,
        project_id: meta.project_uuid,
        project_title: project.title,
        agent: meta.agent,
        session_id: meta.session_id,
        agent_command: meta.command,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
      };
    }
    return null;
  },

  touchSession(id: string) {
    const session = this.getSession(id);
    if (!session) return;
    const meta = readSessionMeta(session.project_id, session.id);
    if (!meta) return;
    meta.updated_at = Math.floor(Date.now() / 1000);
    writeSessionMeta(meta);
  },
};

export default storageOps;
