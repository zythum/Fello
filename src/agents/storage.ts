import { readFile } from "fs/promises";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { FELLO_DIR } from "../backend/storage";
import type { ModelMessage } from "ai";
import type { PermissionKind } from "./permission";

type SessionJson = {
  modelId: string | null;
  allowedToolKinds: string[];
  contextUsedTokens?: number;
};

type PersistedSessionState = {
  modelId: string | null;
  allowedToolKinds: PermissionKind[];
  contextUsedTokens: number;
};

function toSafePathSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "unknown";
  return normalized.replace(/[\\/]/g, "_");
}

function apiAgentSessionDir(agentId: string, sessionId: string): string {
  return join(
    FELLO_DIR,
    "api-agents",
    toSafePathSegment(agentId),
    "sessions",
    toSafePathSegment(sessionId),
  );
}

function sessionJsonPath(agentId: string, sessionId: string): string {
  return join(apiAgentSessionDir(agentId, sessionId), "session.json");
}

function historyJsonlPath(agentId: string, sessionId: string): string {
  return join(apiAgentSessionDir(agentId, sessionId), "history.jsonl");
}

function isModelMessage(value: unknown): value is ModelMessage {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { role?: unknown };
  return typeof maybe.role === "string";
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException;
    if (maybe.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadPersistedSessionState(params: {
  agentId: string;
  sessionId: string;
}): Promise<PersistedSessionState | null> {
  const sessionRaw = await readFileIfExists(sessionJsonPath(params.agentId, params.sessionId));
  if (sessionRaw === null) return null;

  let modelId: string | null = null;
  let allowedToolKinds: PermissionKind[] = [];
  let contextUsedTokens = 0;
  try {
    const parsed = JSON.parse(sessionRaw) as Partial<SessionJson>;
    modelId = typeof parsed.modelId === "string" ? parsed.modelId : null;
    allowedToolKinds = Array.isArray(parsed.allowedToolKinds)
      ? parsed.allowedToolKinds
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .map((value) => value as PermissionKind)
      : [];
    contextUsedTokens = typeof parsed.contextUsedTokens === "number" ? parsed.contextUsedTokens : 0;
  } catch {
    modelId = null;
    allowedToolKinds = [];
    contextUsedTokens = 0;
  }

  return { modelId, allowedToolKinds, contextUsedTokens };
}

export async function loadPersistedSessionHistory(params: {
  agentId: string;
  sessionId: string;
}): Promise<ModelMessage[]> {
  const historyRaw = await readFileIfExists(historyJsonlPath(params.agentId, params.sessionId));
  if (!historyRaw) return [];
  return historyRaw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((value): value is ModelMessage => isModelMessage(value));
}

function ensureSessionDirSync(agentId: string, sessionId: string): void {
  mkdirSync(apiAgentSessionDir(agentId, sessionId), { recursive: true });
}

export async function savePersistedSessionState(params: {
  agentId: string;
  sessionId: string;
  modelId: string | null;
  allowedToolKinds: PermissionKind[];
  contextUsedTokens?: number;
}): Promise<void> {
  ensureSessionDirSync(params.agentId, params.sessionId);

  const sessionJson: SessionJson = {
    modelId: params.modelId,
    allowedToolKinds: params.allowedToolKinds,
    contextUsedTokens: params.contextUsedTokens,
  };
  writeFileSync(
    sessionJsonPath(params.agentId, params.sessionId),
    JSON.stringify(sessionJson, null, 2),
    "utf8",
  );
}

export async function savePersistedSessionHistory(params: {
  agentId: string;
  sessionId: string;
  messages: ModelMessage[];
}): Promise<void> {
  ensureSessionDirSync(params.agentId, params.sessionId);
  const lines = params.messages.map((message) => JSON.stringify(message)).join("\n");
  writeFileSync(
    historyJsonlPath(params.agentId, params.sessionId),
    lines ? `${lines}\n` : "",
    "utf8",
  );
}

export async function appendPersistedSessionHistory(params: {
  agentId: string;
  sessionId: string;
  messages: ModelMessage[];
}): Promise<void> {
  if (params.messages.length === 0) return;
  ensureSessionDirSync(params.agentId, params.sessionId);
  const lines = params.messages.map((message) => JSON.stringify(message)).join("\n");
  appendFileSync(historyJsonlPath(params.agentId, params.sessionId), `${lines}\n`, "utf8");
}

export function deletePersistedSessionDirectory(params: {
  agentId: string;
  sessionId: string;
}): void {
  rmSync(apiAgentSessionDir(params.agentId, params.sessionId), {
    recursive: true,
    force: true,
  });
}
