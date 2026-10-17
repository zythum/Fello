import { join } from "path";

import { mkdirSync, appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";

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

import { HISTORY_PAGE_SIZE } from "../../shared/constants";

import type { SessionNotificationFelloExt, SessionTokenUsage } from "../../shared/schema";

const MAX_MESSAGE_SEGMENT_BYTES = 16 * 1024 * 1024;
const MESSAGE_SEGMENT_RE = /^messages(?:-(\d{6}))?\.jsonl$/;

interface MessageSegment {
  id: number;
  filePath: string;
}

function getMessageSegmentFileName(id: number): string {
  return id === 0 ? "messages.jsonl" : `messages-${String(id).padStart(6, "0")}.jsonl`;
}

function listSessionMessageSegments(sessionIdOrSubSessionId: string): MessageSegment[] {
  const dir = sessionDir(sessionIdOrSubSessionId);
  if (!dir || !existsSync(dir)) return [];

  return readdirSync(dir)
    .flatMap((fileName) => {
      const match = MESSAGE_SEGMENT_RE.exec(fileName);
      if (!match) return [];
      const id = match[1] ? Number(match[1]) : 0;
      return [{ id, filePath: join(dir, fileName) }];
    })
    .sort((a, b) => a.id - b.id);
}

function parseSessionMessages(content: string): SessionNotificationFelloExt[] {
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

function isMainUserMessage(
  sessionIdOrSubSessionId: string,
  notification: SessionNotificationFelloExt,
): boolean {
  if (notification.update.sessionUpdate !== "user_message_chunk") return false;
  const separatorIndex = sessionIdOrSubSessionId.indexOf(":");
  const resumeId =
    separatorIndex === -1
      ? sessionIdOrSubSessionId
      : sessionIdOrSubSessionId.slice(separatorIndex + 1);
  return notification.sessionId === resumeId;
}

function getCurrentMessageSegment(sessionIdOrSubSessionId: string): MessageSegment {
  const dir = sessionDir(sessionIdOrSubSessionId);
  if (!dir) throw new Error("Session directory is unavailable");
  mkdirSync(dir, { recursive: true });

  const segments = listSessionMessageSegments(sessionIdOrSubSessionId);
  return (
    segments[segments.length - 1] ?? {
      id: 0,
      filePath: join(dir, getMessageSegmentFileName(0)),
    }
  );
}

function countMainUserMessages(
  sessionIdOrSubSessionId: string,
  notifications: SessionNotificationFelloExt[],
): number {
  return notifications.filter((notification) =>
    isMainUserMessage(sessionIdOrSubSessionId, notification),
  ).length;
}

function getMessageSegmentTurnCount(sessionIdOrSubSessionId: string, filePath: string): number {
  if (!existsSync(filePath)) return 0;
  return countMainUserMessages(
    sessionIdOrSubSessionId,
    parseSessionMessages(readFileSync(filePath, "utf-8")),
  );
}

const activePromptSegments = new Map<string, MessageSegment>();

function beginSessionMessageTurn(sessionIdOrSubSessionId: string): void {
  let segment = getCurrentMessageSegment(sessionIdOrSubSessionId);
  if (existsSync(segment.filePath)) {
    const turnCount = getMessageSegmentTurnCount(sessionIdOrSubSessionId, segment.filePath);
    const byteSize = statSync(segment.filePath).size;
    if (
      turnCount > 0 &&
      (turnCount >= HISTORY_PAGE_SIZE || byteSize >= MAX_MESSAGE_SEGMENT_BYTES)
    ) {
      const dir = sessionDir(sessionIdOrSubSessionId);
      if (!dir) throw new Error("Session directory is unavailable");
      segment = {
        id: segment.id + 1,
        filePath: join(dir, getMessageSegmentFileName(segment.id + 1)),
      };
    }
  }

  activePromptSegments.set(sessionIdOrSubSessionId, segment);
}

function endSessionMessageTurn(sessionIdOrSubSessionId: string): void {
  activePromptSegments.delete(sessionIdOrSubSessionId);
}

function appendSessionMessage(
  sessionIdOrSubSessionId: string,
  notification: SessionNotificationFelloExt,
) {
  const segment =
    activePromptSegments.get(sessionIdOrSubSessionId) ??
    getCurrentMessageSegment(sessionIdOrSubSessionId);
  appendFileSync(segment.filePath, JSON.stringify(notification) + "\n");
}

function readSessionMessageSegment(
  sessionIdOrSubSessionId: string,
  segmentId?: number,
): {
  segmentId: number;
  previousSegmentId?: number;
  messages: SessionNotificationFelloExt[];
} {
  const segments = listSessionMessageSegments(sessionIdOrSubSessionId);
  if (segments.length === 0) {
    return { segmentId: 0, messages: [] };
  }

  const segment =
    segmentId === undefined
      ? segments[segments.length - 1]
      : segments.find((candidate) => candidate.id === segmentId);
  if (!segment) {
    throw new Error(`Message segment ${segmentId} does not exist`);
  }

  const index = segments.findIndex((candidate) => candidate.id === segment.id);
  const latestMessages = parseSessionMessages(readFileSync(segment.filePath, "utf-8"));
  const previousSegment = index > 0 ? segments[index - 1] : undefined;

  // The initial request may combine one predecessor so a size-limited latest
  // segment does not leave the first screen with only a few user groups.
  if (
    segmentId === undefined &&
    previousSegment &&
    countMainUserMessages(sessionIdOrSubSessionId, latestMessages) < HISTORY_PAGE_SIZE
  ) {
    const previousMessages = parseSessionMessages(readFileSync(previousSegment.filePath, "utf-8"));
    const beforePreviousSegment = index > 1 ? segments[index - 2] : undefined;
    return {
      segmentId: segment.id,
      ...(beforePreviousSegment ? { previousSegmentId: beforePreviousSegment.id } : {}),
      messages: [...previousMessages, ...latestMessages],
    };
  }

  return {
    segmentId: segment.id,
    ...(previousSegment ? { previousSegmentId: previousSegment.id } : {}),
    messages: latestMessages,
  };
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

  beginSessionMessageTurn,
  endSessionMessageTurn,
  appendSessionMessage,
  readSessionMessageSegment,
  appendTerminalOutput,
  readTerminalOutput,
  appendTokenUsage,
  readTokenUsage,
};

export { FELLO_DIR, SOCKETS_DIR, PROJECTS_DIR, TEMP_DIR };
