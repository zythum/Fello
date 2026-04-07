import { basename, join } from "path";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";
import { createHash } from "crypto";
import { DATA_DIR, PROJECTS_DIR } from "./constants";
import { DEFAULT_SETTINGS, type SettingsMeta } from "./interfaces";
import type { ProjectInfo, SessionInfo } from "./ipc-schema";

mkdirSync(PROJECTS_DIR, { recursive: true });

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
    const raw = JSON.parse(readFileSync(sessionMetaPath(projectId, sessionId), "utf-8")) as Record<
      string,
      unknown
    > | null;
    if (!raw) return null;
    const id = String(raw.id);
    const title = String(raw.title || "");
    const agent_id = String(raw.agent_id);
    const resume_id = String(raw.resume_id);
    const project_id = String(raw.project_id);
    const created_at =
      typeof raw.created_at === "number" ? raw.created_at : Math.floor(Date.now() / 1000);
    const updated_at = typeof raw.updated_at === "number" ? raw.updated_at : created_at;
    if (!id || !agent_id || !resume_id || !project_id) return null;
    return { id, title, agent_id, resume_id, project_id, created_at, updated_at };
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
  getSettings() {
    return readSettings();
  },

  updateSettings(settings: SettingsMeta) {
    writeSettings(settings);
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

  createSession(projectId: string, resumeId: string, agentId: string) {
    const project = readProjectMeta(projectId);
    if (!project) throw new Error("Project does not exist");
    const now = Math.floor(Date.now() / 1000);
    const id = `${agentId}:${resumeId}`;
    writeSessionMeta({
      id: id,
      title: "New Chat",
      agent_id: agentId,
      resume_id: resumeId,
      project_id: projectId,
      created_at: now,
      updated_at: now,
    });
    return id;
  },

  updateSessionTitle(id: string, title: string) {
    const session = this.getSession(id);
    if (!session) return;
    const meta = readSessionMeta(session.projectId, session.id);
    if (!meta) return;
    meta.title = title;
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
};

export default storageOps;
