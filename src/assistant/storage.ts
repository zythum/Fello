import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { ModelMessage } from "ai";
import type { SessionNotificationFelloExt } from "../shared/schema";
import { HISTORY_PAGE_SIZE } from "../shared/constants";

const ASSISTANT_STORAGE_DIR = join(homedir(), ".fello", "assistant");
const AGENT_STORAGE_DIR = join(ASSISTANT_STORAGE_DIR, "agent");
const SESSION_STORAGE_DIR = join(ASSISTANT_STORAGE_DIR, "session");

const SESSION_STATE_PATH = join(AGENT_STORAGE_DIR, "session.json");
const MODEL_HISTORY_PATH = join(AGENT_STORAGE_DIR, "history.jsonl");
const MEMORY_PATH = join(AGENT_STORAGE_DIR, "memory.md");

const MAX_MESSAGE_SEGMENT_BYTES = 16 * 1024 * 1024;
const MESSAGE_SEGMENT_RE = /^messages(?:-(\d{6}))?\.jsonl$/;

export type AssistantMessageSegment = {
  id: number;
  filePath: string;
};

type MessageSegment = AssistantMessageSegment;
export type PersistedAssistantSession = {
  modelId: string | null;
  thoughtLevel: string;
  contextUsedTokens: number;
  lastDreamAt: string | null;
  historyStartedAt: string | null;
  historyTokens: number;
  needsDream: boolean;
  dreamUrgency: "none" | "scheduled" | "required";
};

function isModelMessage(value: unknown): value is ModelMessage {
  return (
    !!value && typeof value === "object" && typeof (value as { role?: unknown }).role === "string"
  );
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function ensureAgentStorageDirectory(): Promise<void> {
  await mkdir(AGENT_STORAGE_DIR, { recursive: true });
}

async function ensureSessionStorageDirectory(): Promise<void> {
  await mkdir(SESSION_STORAGE_DIR, { recursive: true });
}

function segmentFileName(id: number): string {
  return id === 0 ? "messages.jsonl" : `messages-${String(id).padStart(6, "0")}.jsonl`;
}

async function listMessageSegments(): Promise<MessageSegment[]> {
  await ensureSessionStorageDirectory();
  const names = await readdir(SESSION_STORAGE_DIR);
  return names
    .flatMap((name) => {
      const match = MESSAGE_SEGMENT_RE.exec(name);
      if (!match) return [];
      return [{ id: match[1] ? Number(match[1]) : 0, filePath: join(SESSION_STORAGE_DIR, name) }];
    })
    .sort((a, b) => a.id - b.id);
}

function parseMessages(content: string): SessionNotificationFelloExt[] {
  return content
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as SessionNotificationFelloExt];
      } catch {
        return [];
      }
    });
}

async function getCurrentMessageSegment(): Promise<MessageSegment> {
  const segments = await listMessageSegments();
  return segments.at(-1) ?? { id: 0, filePath: join(SESSION_STORAGE_DIR, segmentFileName(0)) };
}

async function countUserMessages(filePath: string): Promise<number> {
  const content = await readFileIfExists(filePath);
  if (!content) return 0;
  return parseMessages(content).filter(
    (notification) => notification.update.sessionUpdate === "user_message_chunk",
  ).length;
}

let activePromptSegment: MessageSegment | null = null;

export async function beginAssistantMessageTurn(): Promise<AssistantMessageSegment> {
  let segment = await getCurrentMessageSegment();
  const content = await readFileIfExists(segment.filePath);

  if (content !== null) {
    const [turnCount, info] = await Promise.all([
      countUserMessages(segment.filePath),
      stat(segment.filePath),
    ]);
    if (
      turnCount > 0 &&
      (turnCount >= HISTORY_PAGE_SIZE || info.size >= MAX_MESSAGE_SEGMENT_BYTES)
    ) {
      segment = {
        id: segment.id + 1,
        filePath: join(SESSION_STORAGE_DIR, segmentFileName(segment.id + 1)),
      };
    }
  }

  activePromptSegment = segment;
  return segment;
}

export function endAssistantMessageTurn(segment?: AssistantMessageSegment): void {
  if (!segment || activePromptSegment?.id === segment.id) activePromptSegment = null;
}

export async function appendAssistantMessage(
  notification: SessionNotificationFelloExt,
  segment?: AssistantMessageSegment,
): Promise<void> {
  const target = segment ?? activePromptSegment ?? (await getCurrentMessageSegment());
  await ensureSessionStorageDirectory();
  await appendFile(target.filePath, `${JSON.stringify(notification)}\n`, "utf8");
}

export async function readAssistantMessageSegment(segmentId?: number): Promise<{
  segmentId: number;
  previousSegmentId?: number;
  messages: SessionNotificationFelloExt[];
}> {
  const segments = await listMessageSegments();
  if (segments.length === 0) return { segmentId: 0, messages: [] };

  const segment =
    segmentId === undefined
      ? segments.at(-1)!
      : segments.find((candidate) => candidate.id === segmentId);
  if (!segment) throw new Error(`Message segment ${segmentId} does not exist`);

  const index = segments.findIndex((candidate) => candidate.id === segment.id);
  const messages = parseMessages(await readFile(segment.filePath, "utf8"));
  const previous = index > 0 ? segments[index - 1] : undefined;

  if (
    segmentId === undefined &&
    previous &&
    messages.filter((notification) => notification.update.sessionUpdate === "user_message_chunk")
      .length < HISTORY_PAGE_SIZE
  ) {
    const previousMessages = parseMessages(await readFile(previous.filePath, "utf8"));
    const beforePrevious = index > 1 ? segments[index - 2] : undefined;
    return {
      segmentId: segment.id,
      ...(beforePrevious ? { previousSegmentId: beforePrevious.id } : {}),
      messages: [...previousMessages, ...messages],
    };
  }

  return {
    segmentId: segment.id,
    ...(previous ? { previousSegmentId: previous.id } : {}),
    messages,
  };
}

function parseAssistantSession(raw: string): PersistedAssistantSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedAssistantSession>;
    const urgency = parsed.dreamUrgency;
    return {
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : null,
      thoughtLevel: typeof parsed.thoughtLevel === "string" ? parsed.thoughtLevel : "auto",
      contextUsedTokens:
        typeof parsed.contextUsedTokens === "number" ? parsed.contextUsedTokens : 0,
      lastDreamAt: typeof parsed.lastDreamAt === "string" ? parsed.lastDreamAt : null,
      historyStartedAt:
        typeof parsed.historyStartedAt === "string" ? parsed.historyStartedAt : null,
      historyTokens:
        typeof parsed.historyTokens === "number" &&
        Number.isSafeInteger(parsed.historyTokens) &&
        parsed.historyTokens >= 0
          ? parsed.historyTokens
          : 0,
      needsDream: typeof parsed.needsDream === "boolean" ? parsed.needsDream : false,
      dreamUrgency: urgency === "scheduled" || urgency === "required" ? urgency : "none",
    };
  } catch {
    return null;
  }
}

export async function loadAssistantSession(): Promise<PersistedAssistantSession | null> {
  const raw = await readFileIfExists(SESSION_STATE_PATH);
  return raw === null ? null : parseAssistantSession(raw);
}

export async function saveAssistantSession(session: PersistedAssistantSession): Promise<void> {
  await ensureAgentStorageDirectory();
  // Write to a temporary file and rename, so a crash mid-write cannot corrupt session.json.
  const temporaryPath = `${SESSION_STATE_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await rename(temporaryPath, SESSION_STATE_PATH);
}

export async function loadAssistantHistory(): Promise<ModelMessage[]> {
  const raw = await readFileIfExists(MODEL_HISTORY_PATH);
  if (!raw) return [];
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as unknown;
        return isModelMessage(value) ? [value] : [];
      } catch {
        return [];
      }
    });
}

export async function appendAssistantHistory(messages: ModelMessage[]): Promise<void> {
  if (messages.length === 0) return;
  await ensureAgentStorageDirectory();
  await appendFile(
    MODEL_HISTORY_PATH,
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    "utf8",
  );
}

export async function loadAssistantMemory(): Promise<string> {
  return (await readFileIfExists(MEMORY_PATH)) ?? "";
}
