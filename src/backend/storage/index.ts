import { join } from "path";

import { mkdirSync, appendFileSync, existsSync, readFileSync } from "fs";

import "./prepare";

import { getSettings, updateSettings } from "./settings";

import {
  addProject,
  createSession,
  deleteProject,
  deleteSession,
  getProject,
  getSession,
  listProjects,
  listSessions,
  sessionDir,
  sessionShareDir,
  sessionTerminalDir,
  touchSession,
  updateProjectTitle,
  updateSession,
} from "./project-session";

import { FELLO_DIR, SOCKETS_DIR, PROJECTS_DIR, TEMP_DIR } from "./constant";

import type { SessionNotificationFelloExt, SessionTokenUsage } from "../../shared/schema";

function appendSessionMessage(
  sessionIdOrSubSessionId: string,
  notification: SessionNotificationFelloExt,
) {
  const dir = sessionDir(sessionIdOrSubSessionId);
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "messages.jsonl");
  appendFileSync(filePath, JSON.stringify(notification) + "\n");
}

function readSessionMessages(sessionIdOrSubSessionId: string): SessionNotificationFelloExt[] {
  const dir = sessionDir(sessionIdOrSubSessionId);
  if (!dir) return [];
  const filePath = join(dir, "messages.jsonl");
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
}

function appendTerminalOutput(sessionIdOrSubSessionId: string, terminalId: string, data: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(terminalId)) {
    throw new Error("Invalid terminalId");
  }
  const dir = sessionTerminalDir(sessionIdOrSubSessionId);
  if (!dir) return;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, `${terminalId}.log`);
  appendFileSync(filePath, data);
}

function readTerminalOutput(sessionIdOrSubSessionId: string, terminalId: string): string | null {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(terminalId)) {
    throw new Error("Invalid terminalId");
  }
  const dir = sessionTerminalDir(sessionIdOrSubSessionId);
  if (!dir) return null;
  const filePath = join(dir, `${terminalId}.log`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

/**
 * Append a token usage record to the session's token-usage.jsonl file.
 * Each line is a self-contained JSON object with timestamp, prompt correlation,
 * and the full token breakdown.
 */
function appendTokenUsage(sessionId: string, record: SessionTokenUsage) {
  const dir = sessionDir(sessionId);
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "token-usage.jsonl");
  appendFileSync(filePath, JSON.stringify(record) + "\n");
}

function isSessionTokenUsage(value: unknown): value is SessionTokenUsage {
  if (!value || typeof value !== "object") return false;
  const record = value as { timestamp?: unknown; usage?: unknown };
  if (!record || typeof record.timestamp !== "number" || !record.usage) return false;
  if (typeof record.usage !== "object") return false;
  const usage = record.usage as {
    totalTokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  };
  return (
    typeof usage.totalTokens === "number" &&
    typeof usage.inputTokens === "number" &&
    typeof usage.outputTokens === "number"
  );
}

/**
 * Read all token usage records for a session.
 */
function readTokenUsage(sessionId: string): SessionTokenUsage[] {
  const dir = sessionDir(sessionId);
  if (!dir) return [];
  const filePath = join(dir, "token-usage.jsonl");
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((value): value is SessionTokenUsage => isSessionTokenUsage(value));
}

export const storageOps = {
  getSettings,
  updateSettings,

  addProject,
  createSession,
  deleteProject,
  deleteSession,
  getProject,
  getSession,
  listProjects,
  listSessions,
  getSessionDataSystemPath: sessionDir,
  sessionShareDir,
  touchSession,
  updateProjectTitle,
  updateSession,

  appendSessionMessage,
  readSessionMessages,
  appendTerminalOutput,
  readTerminalOutput,
  appendTokenUsage,
  readTokenUsage,
};

export { FELLO_DIR, SOCKETS_DIR, PROJECTS_DIR, TEMP_DIR };
