import { join } from "path";
import { homedir } from "os";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "fs";

const DATA_DIR = join(homedir(), ".cowork");
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
function eventsPath(id: string) {
  return join(sessionDir(id), "events.jsonl");
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

// Strip large fields before persisting
function sanitizeEvent(event: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...event };
  delete copy.rawOutput;
  return copy;
}

export const dbOps = {
  createSession(id: string, cwd: string, agentCommand: string) {
    const now = Math.floor(Date.now() / 1000);
    writeMeta({ id, title: "New Chat", cwd, agentCommand, createdAt: now, updatedAt: now });
    writeFileSync(eventsPath(id), "");
  },

  updateSessionTitle(id: string, title: string) {
    const meta = readMeta(id);
    if (!meta) return;
    meta.title = title;
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

  // Append a raw ACP event (or synthetic user_message) to the session log
  addEvent(sessionId: string, event: Record<string, unknown>) {
    const fp = eventsPath(sessionId);
    const record = {
      ...sanitizeEvent(event),
      _ts: Math.floor(Date.now() / 1000),
    };
    appendFileSync(fp, JSON.stringify(record) + "\n");
    const meta = readMeta(sessionId);
    if (meta) {
      meta.updatedAt = record._ts;
      writeMeta(meta);
    }
  },

  // Read all events for a session
  getEvents(sessionId: string): unknown[] {
    const fp = eventsPath(sessionId);
    if (!existsSync(fp)) return [];
    return readFileSync(fp, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  },
};

export default dbOps;
