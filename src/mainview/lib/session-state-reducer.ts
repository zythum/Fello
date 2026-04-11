import type { SessionNotification, ContentBlock } from "@agentclientprotocol/sdk";
import type { SessionState } from "../store";
import type { ToolCallMessage, ChatMessage } from "../chat-message";

// ---------------------------------------------------------------------------
// Pure Functions for State Calculation
// ---------------------------------------------------------------------------

type UpdatePayload<T extends SessionNotification["update"]["sessionUpdate"]> = Extract<
  SessionNotification["update"],
  { sessionUpdate: T }
>;

function calculateUserMessageChunk(
  state: SessionState,
  update: UpdatePayload<"user_message_chunk">,
): SessionState {
  const content = update.content;
  const msgs = state.messages;

  // Optimistic update deduplication
  const optimisticId = update._meta?.optimistic_id;
  if (optimisticId) {
    const existingIdx = msgs.findIndex((m) => m._meta?.optimistic_id === optimisticId);
    if (existingIdx !== -1) {
      // We found the optimistically added message!
      // Instead of ignoring the backend's chunk, we replace our fake message
      // with the real content and metadata confirmed by the backend.
      const newMessages = [...msgs];
      const existingMsg = newMessages[existingIdx];

      // Extract real metadata and strip the temporary optimistic_id flag
      const { optimistic_id: _optimistic_id, ...realMeta } = update._meta || {};

      newMessages[existingIdx] = {
        ...existingMsg,
        role: "user_message",
        contents: [content], // Use the backend's canonical content
        _meta: Object.keys(realMeta).length > 0 ? realMeta : undefined,
      } satisfies ChatMessage;

      return { ...state, messages: newMessages };
    }
  }

  return {
    ...state,
    messages: [...msgs, { role: "user_message", contents: [content], _meta: update._meta, displayId: crypto.randomUUID() }],
  };
}

function calculateAgentChunk(
  state: SessionState,
  role: "agent_message" | "agent_thought",
  block: ContentBlock,
): SessionState {
  const msgs = [...state.messages];
  const last = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

  if (last && last.role === role && "streaming" in last && last.streaming) {
    const oldContents = last.contents || [];
    const lastBlock = oldContents[oldContents.length - 1];

    if (lastBlock && lastBlock.type === "text" && block.type === "text") {
      const newContents = [...oldContents];
      newContents[newContents.length - 1] = {
        ...lastBlock,
        text: lastBlock.text + block.text,
      };
      msgs[msgs.length - 1] = { ...last, contents: newContents };
    } else {
      msgs[msgs.length - 1] = { ...last, contents: [...oldContents, block] };
    }
  } else {
    // Finalize any prior streaming messages when starting a new one
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if ("streaming" in m && m.streaming) {
        msgs[i] = { ...m, streaming: false };
      }
    }
    msgs.push({ role, contents: [block], streaming: true, displayId: crypto.randomUUID() } satisfies ChatMessage);
  }
  return { ...state, messages: msgs };
}

function calculateToolCall(
  state: SessionState,
  update: UpdatePayload<"tool_call" | "tool_call_update">,
): SessionState {
  let terminalId: string | null = null;
  if (Array.isArray(update.content)) {
    for (const content of update.content) {
      if (content.type === "terminal") {
        terminalId = content.terminalId;
      }
    }
  }

  const newMap = new Map(state.activeToolCalls);
  const existing =
    newMap.get(update.toolCallId) ||
    ({
      role: "tool_call",
      toolCallId: update.toolCallId,
      title: "",
      status: "completed",
      content: [],
      locations: [],
      displayId: crypto.randomUUID(),
    } satisfies ToolCallMessage);

  const data: Partial<ToolCallMessage> = {
    title: update.title ?? "",
    status: update.status || "completed",
    content: update.content || [],
    kind: update.kind ?? undefined,
    rawInput: update.rawInput,
    locations: update.locations ?? [],
  };
  if (terminalId) data.terminalId = terminalId;

  const filtered = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v != null && v !== ""),
  );
  const merged: ToolCallMessage = { ...existing, ...filtered };

  newMap.set(update.toolCallId, merged);

  // Also upsert into messages so tools appear interleaved with other roles
  const msgs = [...state.messages];
  const idx = msgs.findIndex((m) => m.role === "tool_call" && m.toolCallId === update.toolCallId);

  if (idx !== -1) {
    msgs[idx] = merged;
  } else {
    msgs.push(merged);
  }

  return { ...state, activeToolCalls: newMap, messages: msgs };
}

function calculateUsageUpdate(
  state: SessionState,
  update: UpdatePayload<"usage_update">,
): SessionState {
  return {
    ...state,
    usage: {
      size: update.size ?? 0,
      used: update.used ?? 0,
      cost: update.cost ?? null,
      _meta: update._meta,
    },
  };
}

// ---------------------------------------------------------------------------
// Main Reducer Logic
// ---------------------------------------------------------------------------

export function reduceSessionUpdate(
  currentState: SessionState,
  update: SessionNotification["update"],
): SessionState {
  let nextState: SessionState = currentState;

  switch (update.sessionUpdate) {
    case "user_message_chunk":
      if (update.content) {
        nextState = calculateUserMessageChunk(currentState, update);
      }
      break;

    case "agent_message_chunk":
      if (update.content) {
        nextState = calculateAgentChunk(currentState, "agent_message", update.content);
      }
      break;

    case "agent_thought_chunk":
      if (update.content) {
        nextState = calculateAgentChunk(currentState, "agent_thought", update.content);
      }
      break;

    case "tool_call":
    case "tool_call_update":
      nextState = calculateToolCall(currentState, update);
      break;

    case "usage_update":
      nextState = calculateUsageUpdate(currentState, update);
      break;

    case "current_mode_update":
      nextState = { ...currentState, currentModeId: update.currentModeId ?? null };
      break;

    default:
      break;
  }

  return nextState;
}

export function reduceFlushStreaming(currentState: SessionState): SessionState {
  let newMessages = currentState.messages;

  // Finalize any in-progress tool messages already in the messages array
  if (currentState.activeToolCalls.size > 0) {
    const activeIds = new Set(currentState.activeToolCalls.keys());
    newMessages = newMessages.map((m: ChatMessage) => {
      if (m.role === "tool_call" && m.toolCallId && activeIds.has(m.toolCallId)) {
        const status =
          m.status === "in_progress" || m.status === "pending" ? "completed" : m.status;
        return { ...m, status };
      }
      return m;
    });
  }

  // Finalize streaming messages
  newMessages = newMessages.map((m: ChatMessage) =>
    "streaming" in m && m.streaming ? { ...m, streaming: false } : m,
  );

  return {
    ...currentState,
    messages: newMessages,
    activeToolCalls: new Map(), // clearToolCalls logic
    isStreaming: false, // finalize the streaming cycle
  };
}
