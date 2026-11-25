import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "fs/promises";
import { join } from "path";
import type { ModelMessage } from "ai";
import type { SessionNotificationFelloExt } from "../shared/schema";
import { HISTORY_PAGE_SIZE } from "../shared/constants";
import type { AssistantPaths } from "./config";

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
  /**
   * Target time of the dream that is currently armed. Persisted so a target the app was
   * closed or asleep through can be caught up instead of silently skipped.
   */
  dreamScheduledFor: string | null;
};

const MAX_MESSAGE_SEGMENT_BYTES = 16 * 1024 * 1024;
const MESSAGE_SEGMENT_RE = /^messages(?:-(\d{6}))?\.jsonl$/;

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

function segmentFileName(id: number): string {
  return id === 0 ? "messages.jsonl" : `messages-${String(id).padStart(6, "0")}.jsonl`;
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
      dreamScheduledFor:
        typeof parsed.dreamScheduledFor === "string" &&
        Number.isFinite(Date.parse(parsed.dreamScheduledFor))
          ? parsed.dreamScheduledFor
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Per-assistant persistence. Every instance owns its directory and its active prompt
 * segment, so several assistants can stream at the same time without sharing state.
 */
export class AssistantStorage {
  readonly paths: AssistantPaths;
  private activePromptSegment: MessageSegment | null = null;

  constructor(paths: AssistantPaths) {
    this.paths = paths;
  }

  private get sessionStatePath(): string {
    return join(this.paths.sessionDir, "state.json");
  }

  private get historyPath(): string {
    return join(this.paths.sessionDir, "history.jsonl");
  }

  private get memoryPath(): string {
    return join(this.paths.memoryDir, "memory.md");
  }

  private async ensureSessionDirectory(): Promise<void> {
    await mkdir(this.paths.sessionDir, { recursive: true });
  }

  private async ensureChatDirectory(): Promise<void> {
    await mkdir(this.paths.chatDir, { recursive: true });
  }

  private async listMessageSegments(): Promise<MessageSegment[]> {
    await this.ensureChatDirectory();
    const names = await readdir(this.paths.chatDir);
    return names
      .flatMap((name) => {
        const match = MESSAGE_SEGMENT_RE.exec(name);
        if (!match) return [];
        return [
          {
            id: match[1] ? Number(match[1]) : 0,
            filePath: join(this.paths.chatDir, name),
          },
        ];
      })
      .sort((a, b) => a.id - b.id);
  }

  private async getCurrentMessageSegment(): Promise<MessageSegment> {
    const segments = await this.listMessageSegments();
    return (
      segments.at(-1) ?? {
        id: 0,
        filePath: join(this.paths.chatDir, segmentFileName(0)),
      }
    );
  }

  private async countUserMessages(filePath: string): Promise<number> {
    const content = await readFileIfExists(filePath);
    if (!content) return 0;
    return parseMessages(content).filter(
      (notification) => notification.update.sessionUpdate === "user_message_chunk",
    ).length;
  }

  async beginMessageTurn(): Promise<AssistantMessageSegment> {
    let segment = await this.getCurrentMessageSegment();
    const content = await readFileIfExists(segment.filePath);

    if (content !== null) {
      const [turnCount, info] = await Promise.all([
        this.countUserMessages(segment.filePath),
        stat(segment.filePath),
      ]);
      if (
        turnCount > 0 &&
        (turnCount >= HISTORY_PAGE_SIZE || info.size >= MAX_MESSAGE_SEGMENT_BYTES)
      ) {
        segment = {
          id: segment.id + 1,
          filePath: join(this.paths.chatDir, segmentFileName(segment.id + 1)),
        };
      }
    }

    this.activePromptSegment = segment;
    return segment;
  }

  endMessageTurn(segment?: AssistantMessageSegment): void {
    if (!segment || this.activePromptSegment === segment) {
      this.activePromptSegment = null;
    }
  }

  async appendMessage(
    notification: SessionNotificationFelloExt,
    segment?: AssistantMessageSegment,
  ): Promise<void> {
    const target = segment ?? this.activePromptSegment ?? (await this.getCurrentMessageSegment());
    await this.ensureChatDirectory();
    await appendFile(target.filePath, `${JSON.stringify(notification)}\n`, "utf8");
  }

  async readMessageSegment(segmentId?: number): Promise<{
    segmentId: number;
    previousSegmentId?: number;
    messages: SessionNotificationFelloExt[];
  }> {
    const segments = await this.listMessageSegments();
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

  async loadSession(): Promise<PersistedAssistantSession | null> {
    const raw = await readFileIfExists(this.sessionStatePath);
    return raw === null ? null : parseAssistantSession(raw);
  }

  async saveSession(session: PersistedAssistantSession): Promise<void> {
    await this.ensureSessionDirectory();
    // Write to a temporary file and rename, so a crash mid-write cannot corrupt state.json.
    const temporaryPath = `${this.sessionStatePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.sessionStatePath);
  }

  async loadHistory(): Promise<ModelMessage[]> {
    const raw = await readFileIfExists(this.historyPath);
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

  async appendHistory(messages: ModelMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.ensureSessionDirectory();
    await appendFile(
      this.historyPath,
      `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
      "utf8",
    );
  }

  async loadMemory(): Promise<string> {
    return (await readFileIfExists(this.memoryPath)) ?? "";
  }

  /** Paths used by Dream, which replaces whole files instead of appending. */
  get dreamPaths(): {
    diaryDir: string;
    memoryPath: string;
    historyPath: string;
    sessionPath: string;
  } {
    return {
      diaryDir: this.paths.diaryDir,
      memoryPath: this.memoryPath,
      historyPath: this.historyPath,
      sessionPath: this.sessionStatePath,
    };
  }
}
