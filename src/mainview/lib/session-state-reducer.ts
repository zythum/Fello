import type { SessionNotificationFelloExt } from "../../shared/schema";
import i18n from "../i18n";
import type { SessionState } from "../store";
import type { ToolCallMessage, ChatMessage, PlanMessage } from "./chat-message";

// ---------------------------------------------------------------------------
// Pure Functions for State Calculation
// ---------------------------------------------------------------------------

type UpdatePayload<T extends SessionNotificationFelloExt["update"]["sessionUpdate"]> = Extract<
  SessionNotificationFelloExt["update"],
  { sessionUpdate: T }
>;

function calculateUserMessageChunk(
  state: SessionState,
  update: UpdatePayload<"user_message_chunk">,
): SessionState {
  const content = update.content;
  const messages = state.messages;

  // Optimistic update deduplication
  const optimisticId = content._meta?.optimistic_id;
  const displayId = content._meta?.display_id;
  if (typeof optimisticId === "string" && typeof displayId === "string") {
    const messageIdx = messages.findIndex((m) => m.displayId === displayId);
    if (messageIdx !== -1) {
      // We found the optimistically added message!
      // Instead of ignoring the backend's chunk, we replace our fake message
      // with the real content and metadata confirmed by the backend.

      const existingMsg = messages[messageIdx];
      if (existingMsg.role === "user_message") {
        const contents = existingMsg.contents;
        const contentIdx = contents.findIndex((c) => c._meta?.optimistic_id === optimisticId);
        if (contentIdx !== -1) {
          const newContents = [...contents];
          newContents[contentIdx] = content;
          const newMessages = [...messages];
          newMessages[messageIdx] = {
            ...existingMsg,
            role: "user_message",
            contents: newContents, // Use the backend's canonical content
          } satisfies ChatMessage;

          return { ...state, messages: newMessages };
        }
      }
    }
  }

  return {
    ...state,
    messages: [
      ...messages,
      {
        role: "user_message",
        contents: [content],
        _meta: update._meta,
        displayId: update._meta?.fello?.displayId ?? crypto.randomUUID(),
        receivedAt: update._meta?.fello?.receivedAt ?? Date.now(),
      },
    ],
  };
}

function calculateAgentChunk(
  state: SessionState,
  role: "agent_message" | "agent_thought",
  update: UpdatePayload<"agent_message_chunk"> | UpdatePayload<"agent_thought_chunk">,
): SessionState {
  const block = update.content;
  const msgs = [...state.messages];
  const last = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

  if (last && last.role === role && state.isStreaming) {
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
    msgs.push({
      role,
      contents: [block],
      displayId: update._meta?.fello?.displayId ?? crypto.randomUUID(),
      receivedAt: update._meta?.fello?.receivedAt ?? Date.now(),
    } satisfies ChatMessage);
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
      displayId: update._meta?.fello?.displayId ?? crypto.randomUUID(),
      receivedAt: update._meta?.fello?.receivedAt ?? Date.now(),
    } satisfies ToolCallMessage);

  const data: Partial<ToolCallMessage> = {};
  if (Object.prototype.hasOwnProperty.call(update, "title")) {
    data.title = update.title ?? "";
  }
  if (Object.prototype.hasOwnProperty.call(update, "status") && update.status != null) {
    data.status = update.status;
  }
  if (Object.prototype.hasOwnProperty.call(update, "content")) {
    data.content = update.content ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(update, "kind") && update.kind != null) {
    data.kind = update.kind;
  }
  if (Object.prototype.hasOwnProperty.call(update, "rawInput")) {
    data.rawInput = update.rawInput;
  }
  if (Object.prototype.hasOwnProperty.call(update, "locations")) {
    data.locations = update.locations ?? [];
  }
  if (terminalId) data.terminalId = terminalId;

  const merged: ToolCallMessage = { ...existing, ...data };

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
  update: SessionNotificationFelloExt["update"],
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
        nextState = calculateAgentChunk(currentState, "agent_message", update);
      }
      break;

    case "agent_thought_chunk":
      if (update.content) {
        nextState = calculateAgentChunk(currentState, "agent_thought", update);
      }
      break;

    case "tool_call":
    case "tool_call_update":
      nextState = calculateToolCall(currentState, update);
      break;

    case "plan":
      nextState = {
        ...currentState,
        messages: [
          ...currentState.messages,
          {
            role: "plan",
            entries: update.entries ?? [],
            _meta: update._meta,
            displayId: update._meta?.fello?.displayId ?? crypto.randomUUID(),
            receivedAt: update._meta?.fello?.receivedAt ?? Date.now(),
          } satisfies PlanMessage,
        ],
      };
      break;

    case "session_info_update":
      if (update._meta) {
        if (typeof update._meta.isStreaming === "boolean") {
          nextState = { ...currentState, isStreaming: update._meta.isStreaming };
        }

        if (update.title && typeof update.title === "string") {
          // Note: update.title will be extracted by the App level listener
          // which can call request.updateSessionTitle IPC to persist it.
          // We can optionally keep it in state if needed, but Fello reads session title from global AppStore sessions.
        }

        if (update._meta.usage) {
          const usage = update._meta.usage as {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            cachedReadTokens?: number;
          };
          nextState = {
            ...nextState,
            messages: [
              ...nextState.messages,
              {
                role: "system_message",
                kind: "info",
                displayId: update._meta?.fello?.displayId ?? crypto.randomUUID(),
                receivedAt: update._meta?.fello?.receivedAt ?? Date.now(),
                contents: [
                  i18n.t("session.usageSummary", {
                    total: usage.totalTokens,
                    input: usage.inputTokens,
                    output: usage.outputTokens,
                    cachedPart: usage.cachedReadTokens
                      ? i18n.t("session.usageSummaryCached", {
                          cached: usage.cachedReadTokens,
                        })
                      : "",
                  }),
                ],
              } satisfies ChatMessage,
            ],
          };
        }
      }
      break;

    case "usage_update":
      nextState = calculateUsageUpdate(currentState, update);
      break;

    case "current_mode_update":
      // modes state is now updated via session-changed IPC
      break;

    default:
      break;
  }

  return nextState;
}

export function reduceFlushStreaming(currentState: SessionState): SessionState {
  const newMessages = currentState.messages.map((m: ChatMessage) => {
    if (m.role === "tool_call" && (m.status === "in_progress" || m.status === "pending")) {
      return { ...m, status: "completed" as const };
    }
    return m;
  });

  return {
    ...currentState,
    messages: newMessages,
    activeToolCalls: new Map(), // clearToolCalls logic
    isStreaming: false, // finalize the streaming cycle
  };
}
