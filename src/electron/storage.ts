import { join } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";

const DATA_DIR = join(homedir(), ".fello");
const SESSIONS_DIR = join(DATA_DIR, "sessions");
mkdirSync(SESSIONS_DIR, { recursive: true });

interface SessionMeta {
  id: string;
  title: string;
  cwd: string;
  agentCommand: string;
  createdAt: number;
  updatedAt: number;
}

function sessionDir(id: string) {
  return join(SESSIONS_DIR, id);
}

function metaPath(id: string) {
  return join(sessionDir(id), "meta.json");
}

function readMeta(id: string): SessionMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(id), "utf-8"));
  } catch {
    return null;
  }
}

function writeMeta(meta: SessionMeta) {
  mkdirSync(sessionDir(meta.id), { recursive: true });
  writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

export const storageOps = {
  createSession(id: string, cwd: string, agentCommand: string) {
    const now = Math.floor(Date.now() / 1000);
    writeMeta({ id, title: "New Chat", cwd, agentCommand, createdAt: now, updatedAt: now });
  },

  updateSessionTitle(id: string, title: string) {
    const meta = readMeta(id);
    if (!meta) return;
    meta.title = title;
    meta.updatedAt = Math.floor(Date.now() / 1000);
    writeMeta(meta);
  },

  updateSessionCwd(id: string, cwd: string) {
    const meta = readMeta(id);
    if (!meta) return;
    meta.cwd = cwd;
    meta.updatedAt = Math.floor(Date.now() / 1000);
    writeMeta(meta);
  },

  deleteSession(id: string) {
    const dir = sessionDir(id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  },

  listSessions() {
    if (!existsSync(SESSIONS_DIR)) return [];
    const dirs = readdirSync(SESSIONS_DIR);
    const sessions: SessionMeta[] = [];
    for (const d of dirs) {
      const meta = readMeta(d);
      if (meta) sessions.push(meta);
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      cwd: s.cwd,
      agent_command: s.agentCommand,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    }));
  },

  getSession(id: string) {
    const meta = readMeta(id);
    if (!meta) return null;
    return {
      id: meta.id,
      title: meta.title,
      cwd: meta.cwd,
      agent_command: meta.agentCommand,
      created_at: meta.createdAt,
      updated_at: meta.updatedAt,
    };
  },

  touchSession(id: string) {
    const meta = readMeta(id);
    if (!meta) return;
    meta.updatedAt = Math.floor(Date.now() / 1000);
    writeMeta(meta);
  },
};

export default storageOps;
