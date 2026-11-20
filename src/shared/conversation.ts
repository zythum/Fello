import type { ContentBlock, Plan, ToolCallContent } from "@agentclientprotocol/sdk";
import type { SessionNotificationFelloExt } from "./schema";

/**
 * A conversation is the view a reader (a human or the assistant) gets of an ACP
 * notification stream: user prompts grouped into turns, assistant replies, tool
 * calls, plans and compactions. It is a pure projection: raw notifications stay
 * on disk and this module can be re-run with different rules at any time.
 *
 * Used by the session export and by `worker_read`.
 */

export type ConversationPlanEntryItem = Plan["entries"][number];

export type ConversationTextEntry = {
  /** ACP-facing names: an agent message and an agent thought. */
  kind: "agent_message" | "agent_thought";
  /** Position inside its container (the turn, or the parent subagent). */
  index: number;
  /** Stable within one build; used only for ordering/debugging. */
  id: string;
  /** Epoch milliseconds. */
  at: number;
  text: string;
};

export type ConversationToolEntry = {
  kind: "tool_call";
  index: number;
  /** The ACP toolCallId, unique within a session. */
  id: string;
  at: number;
  toolCallId: string;
  title: string;
  toolKind: string | null;
  /** ACP status: pending / in_progress / completed / failed. */
  status: string | null;
  /** rawInput exactly as stored, or null when the notification carried none. */
  input: unknown;
  /** JSON form of input, derived once so reads can truncate it. */
  inputText: string | null;
  locations: unknown[] | null;
  content: ToolCallContent[] | null;
  /** Text extracted from content, derived once so reads can truncate it. */
  resultText: string | null;
  /** rawOutput when the agent reported one. */
  rawOutput: unknown;
};

export type ConversationPlanEntry = {
  kind: "plan";
  index: number;
  id: string;
  at: number;
  entries: ConversationPlanEntryItem[];
};

export type ConversationCompactionEntry = {
  kind: "compaction";
  index: number;
  id: string;
  at: number;
  compactionId: string;
  status: string;
  summary: ContentBlock[];
  error?: string;
};

export type ConversationSubagentEntry = {
  kind: "subagent";
  index: number;
  /** ACP session id of the subagent. */
  id: string;
  at: number;
  sessionId: string;
  name: string;
  prompt: string;
  status: string | null;
  entries: ConversationEntry[];
};

export type ConversationEntry =
  | ConversationTextEntry
  | ConversationToolEntry
  | ConversationPlanEntry
  | ConversationCompactionEntry
  | ConversationSubagentEntry;

export type ConversationTurn = {
  /** Id of the prompt that started the turn. `prelude` covers notifications before the first prompt. */
  id: string;
  /** 1-based position in the built conversation. */
  index: number;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds; last notification seen in the turn. */
  endedAt: number;
  /** Text of the user prompt. Non-text blocks live in `promptBlocks`. */
  prompt: string;
  /** Prompt content blocks without ACP `_meta` (that metadata is UI bookkeeping). */
  promptBlocks: ContentBlock[];
  entries: ConversationEntry[];
  /** Present when the reader has turn metadata (worker reads); exports leave it undefined. */
  stopReason?: string | null;
  /** Present when the reader has turn metadata (worker reads); exports leave it undefined. */
  error?: string | null;
};

export type BuildConversationOptions = {
  /**
   * ACP (resume) session id of the main conversation. Notifications whose
   * `sessionId` differs are folded into `subagent` entries. Omit to treat
   * everything as the main session.
   */
  sessionId?: string;
  /** Keep `agent_thought_chunk` entries. Default true. */
  includeThoughts?: boolean;
};

type TurnDraft = ConversationTurn & { promptGroupId: string | null };

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  failed: 2,
};

function withoutMeta(block: ContentBlock): ContentBlock {
  if (!("_meta" in block) || block._meta === undefined) return block;
  const copy = { ...block };
  delete (copy as { _meta?: unknown })._meta;
  return copy;
}

function textBlock(block: unknown): string | null {
  if (!block || typeof block !== "object") return null;
  const candidate = block as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : null;
}

function stringifyInput(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** Text carried by tool_call content blocks; other block types are not text. */
function toolResultText(content: ToolCallContent[] | null): string | null {
  if (!content) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text" && item.content.text) {
      parts.push(item.content.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function subagentUpdate(
  update: SessionNotificationFelloExt["update"],
): { sessionId: string; name?: string; prompt?: string; status?: string } | null {
  const addon = update._meta?.fello?.update;
  if (!addon || addon.sessionUpdate !== "subagent_update") return null;
  if (typeof addon.sessionId !== "string" || !addon.sessionId) return null;
  return addon;
}

function isTextKind(kind: ConversationEntry["kind"]): kind is "agent_message" | "agent_thought" {
  return kind === "agent_message" || kind === "agent_thought";
}

/**
 * Groups raw notifications into turns. A turn starts at a user_message_chunk and
 * ends before the next one (or at EOF). The turn id is the prompt's stable id:
 * the content `display_id` when present (multi-block prompts share it), otherwise
 * the notification's `displayId` (the worker runner uses its turnId there).
 */
export function buildConversationTurns(
  notifications: SessionNotificationFelloExt[],
  options: BuildConversationOptions = {},
): ConversationTurn[] {
  const includeThoughts = options.includeThoughts ?? true;
  const mainSessionId = options.sessionId;
  const turns: TurnDraft[] = [];
  const seenDisplayIds = new Set<string>();
  const tools = new Map<string, ConversationToolEntry>();
  const compactions = new Map<string, ConversationCompactionEntry>();
  let subagents = new Map<string, ConversationSubagentEntry>();
  let activeSubagent: ConversationSubagentEntry | null = null;
  let current: TurnDraft | null = null;
  let lastAt = 0;
  let syntheticId = 0;

  const nextId = (prefix: string): string => `${prefix}:${(syntheticId += 1)}`;

  const targetEntries = (): ConversationEntry[] =>
    activeSubagent ? activeSubagent.entries : current!.entries;

  const createTurn = (id: string, at: number): TurnDraft => {
    current = {
      id,
      index: turns.length + 1,
      startedAt: at,
      endedAt: at,
      prompt: "",
      promptBlocks: [],
      entries: [],
      promptGroupId: null,
    };
    turns.push(current);
    activeSubagent = null;
    subagents = new Map();
    tools.clear();
    compactions.clear();
    return current;
  };

  const ensureTurn = (at: number): TurnDraft => current ?? createTurn("prelude", at);

  const touch = (at: number): void => {
    if (at > lastAt) lastAt = at;
    if (current && at > current.endedAt) current.endedAt = at;
  };

  const pushText = (
    kind: "agent_message" | "agent_thought",
    text: string,
    at: number,
    id: string,
  ): void => {
    const entries = targetEntries();
    const last = entries[entries.length - 1];
    if (last && isTextKind(last.kind) && last.kind === kind) {
      last.text += text;
      return;
    }
    entries.push({ kind, index: entries.length, id, at, text });
  };

  const findSubagent = (sessionId: string, at: number): ConversationSubagentEntry => {
    const turn = ensureTurn(at);
    const existing = subagents.get(sessionId);
    if (existing) return existing;
    const created: ConversationSubagentEntry = {
      kind: "subagent",
      index: turn.entries.length,
      id: sessionId,
      at,
      sessionId,
      name: "",
      prompt: "",
      status: null,
      entries: [],
    };
    turn.entries.push(created);
    subagents.set(sessionId, created);
    return created;
  };

  /**
   * Appends one prompt block. Consecutive blocks of the same prompt belong to one
   * turn: either they share the content `display_id` (the UI writes one per send),
   * or the prompt has no id at all and nothing has been answered yet.
   */
  const appendPrompt = (
    content: ContentBlock,
    contentGroupId: string | null,
    groupId: string | null,
    at: number,
  ): void => {
    let turn: TurnDraft;
    if (
      current !== null &&
      current.entries.length === 0 &&
      (contentGroupId === null ||
        current.promptGroupId === null ||
        current.promptGroupId === contentGroupId)
    ) {
      turn = current;
    } else {
      turn = createTurn(groupId ?? nextId("turn"), at);
    }
    turn.promptGroupId = turn.promptGroupId ?? groupId;
    turn.promptBlocks.push(withoutMeta(content));
    const text = textBlock(content);
    if (text !== null) turn.prompt = turn.prompt ? `${turn.prompt}\n${text}` : text;
    touch(at);
  };

  const upsertTool = (
    update: SessionNotificationFelloExt["update"],
    at: number,
  ): ConversationToolEntry | null => {
    const toolCallId = (update as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId !== "string" || !toolCallId) return null;
    const record = update as {
      title?: unknown;
      kind?: unknown;
      status?: unknown;
      rawInput?: unknown;
      rawOutput?: unknown;
      locations?: unknown;
      content?: unknown;
    };

    let entry = tools.get(toolCallId);
    if (!entry) {
      const content = Array.isArray(record.content) ? (record.content as ToolCallContent[]) : null;
      entry = {
        kind: "tool_call",
        index: targetEntries().length,
        id: toolCallId,
        at,
        toolCallId,
        title: typeof record.title === "string" ? record.title : toolCallId,
        toolKind: typeof record.kind === "string" ? record.kind : null,
        status: typeof record.status === "string" ? record.status : null,
        input: record.rawInput ?? null,
        inputText: stringifyInput(record.rawInput),
        locations: Array.isArray(record.locations) ? record.locations : null,
        content,
        resultText: toolResultText(content),
        rawOutput: record.rawOutput ?? null,
      };
      targetEntries().push(entry);
      tools.set(toolCallId, entry);
      return entry;
    }

    if (typeof record.title === "string") entry.title = record.title;
    if (typeof record.kind === "string") entry.toolKind = record.kind;
    if (typeof record.status === "string") {
      const next = STATUS_ORDER[record.status] ?? 0;
      const currentOrder = entry.status === null ? -1 : (STATUS_ORDER[entry.status] ?? 0);
      // Status moves forward only: a late snapshot must not reopen a finished call.
      if (next >= currentOrder) entry.status = record.status;
    }
    if (Object.prototype.hasOwnProperty.call(record, "rawInput")) {
      entry.input = record.rawInput ?? null;
      entry.inputText = stringifyInput(record.rawInput);
    }
    if (Object.prototype.hasOwnProperty.call(record, "rawOutput")) {
      entry.rawOutput = record.rawOutput ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(record, "locations")) {
      entry.locations = Array.isArray(record.locations) ? record.locations : null;
    }
    if (Array.isArray(record.content) && record.content.length > 0) {
      const next = record.content as ToolCallContent[];
      const types = new Set(next.map((item) => item.type));
      // Same rule as the chat reducer: an update replaces the content types it
      // carries and leaves the others (for example terminal output) in place.
      entry.content = [...(entry.content ?? []).filter((item) => !types.has(item.type)), ...next];
      // Keep the last text result when an update replaces content with a non-text block.
      entry.resultText = toolResultText(entry.content) ?? entry.resultText;
    }
    return entry;
  };

  const upsertCompaction = (update: SessionNotificationFelloExt["update"], at: number): void => {
    const record = update as {
      compactionId?: unknown;
      status?: unknown;
      summary?: unknown;
      error?: unknown;
    };
    if (typeof record.compactionId !== "string" || !record.compactionId) return;
    let entry = compactions.get(record.compactionId);
    if (!entry) {
      entry = {
        kind: "compaction",
        index: targetEntries().length,
        id: record.compactionId,
        at,
        compactionId: record.compactionId,
        status: typeof record.status === "string" ? record.status : "in_progress",
        summary: Array.isArray(record.summary)
          ? (record.summary as ContentBlock[]).map((block) => ({ ...block }))
          : [],
      };
      targetEntries().push(entry);
      compactions.set(record.compactionId, entry);
    }
    if (typeof record.status === "string") entry.status = record.status;
    if (Object.prototype.hasOwnProperty.call(record, "summary") && Array.isArray(record.summary)) {
      // Clone blocks: later summary chunks append into these objects, and the
      // projection must never mutate the raw notifications it was given.
      entry.summary = (record.summary as ContentBlock[]).map((block) => ({ ...block }));
    }
    if (Object.prototype.hasOwnProperty.call(record, "error")) {
      entry.error = typeof record.error === "string" ? record.error : undefined;
    }
  };

  const appendCompactionChunk = (
    update: SessionNotificationFelloExt["update"],
    at: number,
  ): void => {
    const record = update as { compactionId?: unknown; content?: unknown };
    if (typeof record.compactionId !== "string" || !record.compactionId) return;
    let entry = compactions.get(record.compactionId);
    if (!entry) {
      entry = {
        kind: "compaction",
        index: targetEntries().length,
        id: record.compactionId,
        at,
        compactionId: record.compactionId,
        status: "in_progress",
        summary: [],
      };
      targetEntries().push(entry);
      compactions.set(record.compactionId, entry);
    }
    const block = record.content as ContentBlock | undefined;
    if (!block || typeof block !== "object") return;
    const last = entry.summary[entry.summary.length - 1];
    const incoming = textBlock(block);
    if (last && incoming !== null && textBlock(last) !== null) {
      (last as { text: string }).text += incoming;
    } else {
      // Own the block: merging a later chunk mutates it.
      entry.summary.push({ ...block });
    }
  };

  for (const notification of notifications) {
    const update = notification.update;
    if (!update) continue;
    const kind = update.sessionUpdate;
    const displayId = update._meta?.fello?.displayId;
    if (typeof displayId === "string" && displayId) {
      if (seenDisplayIds.has(displayId)) continue;
      seenDisplayIds.add(displayId);
    }

    const at = update._meta?.fello?.receivedAt ?? lastAt;
    const isSub = mainSessionId !== undefined && notification.sessionId !== mainSessionId;

    if (kind === "user_message_chunk") {
      // User chunks from a subagent are not part of the main conversation.
      if (isSub) continue;
      const content = (update as { content?: ContentBlock }).content;
      if (!content || typeof content !== "object") continue;
      const contentGroupId =
        typeof content._meta?.display_id === "string" ? content._meta.display_id : null;
      const groupId = contentGroupId ?? (typeof displayId === "string" ? displayId : null);
      appendPrompt(content, contentGroupId, groupId, at);
      continue;
    }

    if (kind === "session_info_update") {
      const subagent = subagentUpdate(update);
      if (subagent) {
        const entry = findSubagent(subagent.sessionId, at);
        if (typeof subagent.name === "string") entry.name = subagent.name;
        if (typeof subagent.prompt === "string") entry.prompt = subagent.prompt;
        if (typeof subagent.status === "string") entry.status = subagent.status;
        touch(at);
      }
      continue;
    }

    if (
      kind !== "agent_message_chunk" &&
      kind !== "agent_thought_chunk" &&
      kind !== "tool_call" &&
      kind !== "tool_call_update" &&
      kind !== "plan" &&
      kind !== "compaction_update" &&
      kind !== "compaction_summary_chunk"
    ) {
      continue;
    }
    if (kind === "agent_thought_chunk" && !includeThoughts) continue;

    if (isSub) {
      activeSubagent = findSubagent(notification.sessionId, at);
    } else {
      activeSubagent = null;
    }
    ensureTurn(at);

    if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      const content = (update as { content?: ContentBlock }).content;
      const text = content ? textBlock(content) : null;
      if (text === null) continue;
      if (kind === "agent_thought_chunk" && !includeThoughts) continue;
      const entryKind = kind === "agent_message_chunk" ? "agent_message" : "agent_thought";
      pushText(entryKind, text, at, typeof displayId === "string" ? displayId : nextId(entryKind));
      touch(at);
      continue;
    }

    if (kind === "tool_call" || kind === "tool_call_update") {
      upsertTool(update, at);
      touch(at);
      continue;
    }

    if (kind === "plan") {
      const entries = (update as { entries?: unknown }).entries;
      targetEntries().push({
        kind: "plan",
        index: targetEntries().length,
        id: typeof displayId === "string" ? displayId : nextId("plan"),
        at,
        entries: Array.isArray(entries) ? entries : [],
      });
      touch(at);
      continue;
    }

    if (kind === "compaction_update") {
      upsertCompaction(update, at);
      touch(at);
      continue;
    }

    if (kind === "compaction_summary_chunk") {
      appendCompactionChunk(update, at);
      touch(at);
      continue;
    }
  }

  return turns.map((turn) => ({
    id: turn.id,
    index: turn.index,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    prompt: turn.prompt,
    promptBlocks: turn.promptBlocks,
    entries: turn.entries,
  }));
}

/** Metadata for an exported conversation. Times are epoch milliseconds. */
export type ConversationMetadata = {
  id: string;
  title?: string;
  agentId?: string;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type ConversationDocument = {
  kind: "fello-conversation";
  version: 1;
  exportedAt: string;
  session: ConversationMetadata;
  turns: ConversationTurn[];
};

/**
 * Wraps projected turns into the stable JSON export shape. The same shape is used
 * by the session export and (later) by any UI that wants to replay a transcript.
 */
export function buildConversationDocument(
  metadata: ConversationMetadata,
  turns: ConversationTurn[],
): ConversationDocument {
  return {
    kind: "fello-conversation",
    version: 1,
    exportedAt: new Date().toISOString(),
    session: metadata,
    turns,
  };
}

export function stringifyConversationDocument(document: ConversationDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export type ConversationReadLimits = {
  prompt: number;
  text: number;
  toolText: number;
  /** Keep raw tool input/content/output. Summary reads set this false. */
  keepToolRaw: boolean;
};

function truncateText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function truncateEntry(
  entry: ConversationEntry,
  limits: ConversationReadLimits,
): ConversationEntry {
  switch (entry.kind) {
    case "agent_message":
    case "agent_thought":
      return { ...entry, text: truncateText(entry.text, limits.text) };
    case "tool_call":
      return {
        ...entry,
        inputText: entry.inputText ? truncateText(entry.inputText, limits.toolText) : null,
        resultText: entry.resultText ? truncateText(entry.resultText, limits.toolText) : null,
        input: limits.keepToolRaw ? entry.input : null,
        locations: limits.keepToolRaw ? entry.locations : null,
        content: limits.keepToolRaw ? entry.content : null,
        rawOutput: limits.keepToolRaw ? entry.rawOutput : null,
      };
    case "compaction":
      return {
        ...entry,
        summary: entry.summary.map((block) =>
          block.type === "text" ? { ...block, text: truncateText(block.text, limits.text) } : block,
        ),
      };
    case "subagent":
      return {
        ...entry,
        prompt: truncateText(entry.prompt, limits.prompt),
        entries: entry.entries.map((child) => truncateEntry(child, limits)),
      };
    case "plan":
      return entry;
    default:
      return entry;
  }
}

/**
 * Deep-copies a turn with long text trimmed for model reads. Summary reads also
 * strip raw tool payloads; the transcript on disk keeps everything.
 */
export function truncateConversationTurn(
  turn: ConversationTurn,
  limits: ConversationReadLimits,
): ConversationTurn {
  return {
    ...turn,
    prompt: truncateText(turn.prompt, limits.prompt),
    // Keep the block list in sync with the truncated prompt text.
    promptBlocks: turn.promptBlocks.map((block) =>
      block.type === "text" ? { ...block, text: truncateText(block.text, limits.prompt) } : block,
    ),
    entries: turn.entries.map((entry) => truncateEntry(entry, limits)),
  };
}
