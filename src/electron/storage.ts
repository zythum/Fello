import { basename, join } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";
import { createHash } from "crypto";

const DATA_DIR = join(homedir(), ".fello");
const PROJECTS_DIR = join(DATA_DIR, "projects");
mkdirSync(PROJECTS_DIR, { recursive: true });

interface ProjectMeta {
  id: string;
  title: string;
  cwd: string;
  created_at: number;
}

interface SessionMeta {
  id: string;
  title: string;
  agent: string;
  session_id: string;
  project_id: string;
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
    const raw = JSON.parse(readFileSync(projectMetaPath(projectId), "utf-8")) as
      | Record<string, unknown>
      | null;
    if (!raw) return null;
    const id = typeof raw.id === "string" ? raw.id : "";
    const title = typeof raw.title === "string" ? raw.title : "";
    const cwd = typeof raw.cwd === "string" ? raw.cwd : "";
    const created_at =
      typeof raw.created_at === "number"
        ? raw.created_at
        : Math.floor(Date.now() / 1000);
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
    const raw = JSON.parse(readFileSync(sessionMetaPath(projectId, sessionId), "utf-8")) as
      | Record<string, unknown>
      | null;
    if (!raw) return null;
    const id = typeof raw.id === "string" ? raw.id : "";
    const title = typeof raw.title === "string" ? raw.title : "New Chat";
    const agent = typeof raw.agent === "string" ? raw.agent : "kiro";
    const session_id =
      typeof raw.session_id === "string"
        ? raw.session_id
        : "";
    const project_id =
      typeof raw.project_id === "string"
        ? raw.project_id
        : projectId;
    const command =
      typeof raw.command === "string"
        ? raw.command
        : "kiro-cli acp";
    const created_at =
      typeof raw.created_at === "number"
        ? raw.created_at
        : Math.floor(Date.now() / 1000);
    const updated_at =
      typeof raw.updated_at === "number"
        ? raw.updated_at
        : created_at;
    if (!id || !session_id || !project_id) return null;
    return { id, title, agent, session_id, project_id, command, created_at, updated_at };
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
  listProjects() {
    return listProjectMetas().map((p) => ({
      id: p.id,
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
          id: existing.id,
          title: existing.title,
          cwd: existing.cwd,
          created_at: existing.created_at,
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
        created_at: meta.created_at,
      },
      created: true,
    };
  },

  getProject(projectId: string) {
    const project = readProjectMeta(projectId);
    if (!project) return null;
    return {
      id: project.id,
      title: project.title,
      cwd: project.cwd,
      created_at: project.created_at,
    };
  },

  createSession(projectId: string, acpSessionId: string, command: string, agent = "kiro") {
    const project = readProjectMeta(projectId);
    if (!project) throw new Error("Project does not exist");
    const now = Math.floor(Date.now() / 1000);
    const id = `${agent}:${acpSessionId}`;
    writeSessionMeta({
      id,
      title: "New Chat",
      agent,
      session_id: acpSessionId,
      project_id: projectId,
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
      const byProject = listSessionMetasByProject(project.id);
      for (const session of byProject) {
        sessions.push({
          id: session.id,
          title: session.title,
          cwd: project.cwd,
          project_id: session.project_id,
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
      const meta = readSessionMeta(project.id, id);
      if (!meta) continue;
      return {
        id: meta.id,
        title: meta.title,
        cwd: project.cwd,
        project_id: meta.project_id,
        project_title: project.title,
        agent: meta.agent,
        acp_session_id: meta.session_id,
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
