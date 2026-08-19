import { produce } from "immer";
import type { ContentChunk, ToolCall, ToolCallUpdate, Plan } from "@agentclientprotocol/sdk";
import type { SessionNotificationFelloExt, SubagentUpdate } from "../../shared/schema";
import type { SessionState } from "../store";
import type { ToolCallMessage, SubagentMessage, ChatMessage, PlanMessage } from "./chat-message";
import { generateUUID } from "./utils";

function calculateUserMessageChunk(
  state: SessionState,
  subSessionId: string | null,
  update: ContentChunk,
  displayId: string,
  receivedAt: number,
): SessionState {
  if (subSessionId !== null) {
    return state;
  }

  const content = update.content;
  const messages = state.messages;

  // Optimistic update deduplication
  const _optimisticId = content._meta?.optimistic_id;
  const _displayId = content._meta?.display_id;
  if (typeof _optimisticId === "string" && typeof _displayId === "string") {
    const messageIdx = messages.findIndex((m) => m.displayId === _displayId);
    if (messageIdx !== -1) {
      // We found the optimistically added message!
      // Instead of ignoring the backend's chunk, we replace our fake message
      // with the real content and metadata confirmed by the backend.

      const existingMsg = messages[messageIdx];
      if (existingMsg.role === "user_message") {
        const contents = existingMsg.contents;
        const contentIdx = contents.findIndex((c) => c._meta?.optimistic_id === _optimisticId);
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
        displayId,
        receivedAt,
      },
    ],
  };
}

function calculateAgentChunk(
  state: SessionState,
  subSessionId: string | null,
  role: "agent_message" | "agent_thought",
  update: ContentChunk,
  displayId: string,
  receivedAt: number,
): SessionState {
  return produce(state, (state) => {
    const messages = (() => {
      if (!subSessionId) {
        return state.messages;
      }
      let subagentMessage = state.activeSubagents.get(subSessionId);
      if (!subagentMessage) {
        subagentMessage = {
          role: "subagent",
          sessionId: subSessionId,
          name: "",
          prompt: "",
          status: "pending",
          messages: [],
          displayId,
          receivedAt,
        };
      }
      state.activeSubagents.set(subSessionId, subagentMessage);
      return subagentMessage.messages;
    })();

    const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
    const block = update.content;
    if (last && last.role === role) {
      const lastBlock = last.contents[last.contents.length - 1];
      if (lastBlock && lastBlock.type === "text" && block.type === "text") {
        lastBlock.text += block.text;
      } else {
        last.contents.push(block);
      }
    } else {
      messages.push({
        role,
        contents: [block],
        displayId,
        receivedAt,
      });
    }

    // Touch state.messages so that the selector picks up subagent content changes.
    // Immer does not track cross-references: mutating activeSubagents alone won't
    // produce a new state.messages reference, so the chat list won't re-render.
    if (subSessionId) {
      const subagentMessage = state.activeSubagents.get(subSessionId)!;
      const idx = state.messages.findIndex(
        (m) => m.role === "subagent" && m.sessionId === subSessionId,
      );
      if (idx !== -1) {
        state.messages[idx] = subagentMessage;
      }
    }
  });
}

function calculateToolCallUpdate(
  state: SessionState,
  subSessionId: string | null,
  update: ToolCall | ToolCallUpdate,
  displayId: string,
  receivedAt: number,
): SessionState {
  return produce(state, (state) => {
    let terminalId: string | null = null;
    if (Array.isArray(update.content)) {
      for (const content of update.content) {
        if (content.type === "terminal") {
          terminalId = content.terminalId;
        }
      }
    }

    let message: ToolCallMessage | undefined = state.activeToolCalls.get(update.toolCallId);
    if (!message) {
      message = {
        role: "tool_call",
        toolCallId: update.toolCallId,
        title: "",
        status: "in_progress",
        content: [],
        locations: [],
        displayId,
        receivedAt,
      };
      state.activeToolCalls.set(update.toolCallId, message);
    }

    if (Object.prototype.hasOwnProperty.call(update, "title")) {
      message.title = update.title ?? "";
    }
    if (Object.prototype.hasOwnProperty.call(update, "status") && update.status != null) {
      // status 单向推进，避免异常快照（如 Edit 在内容之后又下发 status:"pending"）
      // 把已 completed/failed 的工具调用回退为 pending/in_progress。
      const next = update.status;
      const current = message.status;
      const order = { pending: 0, in_progress: 1, completed: 2, failed: 2 } as const;
      if (current == null || order[next] >= order[current]) {
        message.status = next;
      }
    }
    if (Object.prototype.hasOwnProperty.call(update, "content")) {
      const newContent = update.content ?? [];
      if (newContent.length > 0) {
        message.content = newContent;
      }
    }
    if (Object.prototype.hasOwnProperty.call(update, "kind") && update.kind != null) {
      message.kind = update.kind;
    }
    if (Object.prototype.hasOwnProperty.call(update, "rawInput")) {
      message.rawInput = update.rawInput;
    }
    if (Object.prototype.hasOwnProperty.call(update, "locations")) {
      message.locations = update.locations ?? [];
    }
    if (terminalId) message.terminalId = terminalId;

    const messages = (() => {
      if (!subSessionId) {
        return state.messages;
      }
      let subagentMessage = state.activeSubagents.get(subSessionId);
      if (!subagentMessage) {
        subagentMessage = {
          role: "subagent",
          sessionId: subSessionId,
          name: "",
          prompt: "",
          status: "pending",
          messages: [],
          displayId,
          receivedAt,
        };
      }
      state.activeSubagents.set(subSessionId, subagentMessage);
      return subagentMessage.messages;
    })();

    // If routing to a subagent, remove any stale entry from the main
    // agent's messages. This can happen if the initial tool_call arrived
    // before the member was registered in the adapter's teamStateMap,
    // causing the sessionId to not be rewritten — the tool_call was
    // placed in state.messages (main agent) instead of the subagent.
    if (subSessionId) {
      const mainIdx = state.messages.findIndex(
        (m) => m.role === "tool_call" && m.toolCallId === update.toolCallId,
      );
      if (mainIdx !== -1) {
        state.messages.splice(mainIdx, 1);
      }
    }

    // Also upsert into messages so tools appear interleaved with other roles
    const idx = messages.findIndex(
      (m) => m.role === "tool_call" && m.toolCallId === update.toolCallId,
    );

    if (idx !== -1) {
      messages[idx] = message;
    } else {
      messages.push(message);
    }

    // Sync subagent reference in state.messages for re-render (same reason as calculateAgentChunk)
    if (subSessionId) {
      const subagentMessage = state.activeSubagents.get(subSessionId)!;
      const subIdx = state.messages.findIndex(
        (m) => m.role === "subagent" && m.sessionId === subSessionId,
      );
      if (subIdx !== -1) {
        state.messages[subIdx] = subagentMessage;
      }
    }
  });
}

function calculatePlan(
  state: SessionState,
  subSessionId: string | null,
  update: Plan,
  displayId: string,
  receivedAt: number,
) {
  return produce(state, (state) => {
    const messages = (() => {
      if (!subSessionId) {
        return state.messages;
      }
      let subagentMessage = state.activeSubagents.get(subSessionId);
      if (!subagentMessage) {
        subagentMessage = {
          role: "subagent",
          sessionId: subSessionId,
          name: "",
          prompt: "",
          status: "pending",
          messages: [],
          displayId,
          receivedAt,
        };
      }
      state.activeSubagents.set(subSessionId, subagentMessage);
      return subagentMessage.messages;
    })();

    const message: PlanMessage = {
      role: "plan",
      entries: update.entries,
      displayId,
      receivedAt,
    };
    messages.push(message);

    // Sync subagent reference in state.messages for re-render
    if (subSessionId) {
      const subagentMessage = state.activeSubagents.get(subSessionId)!;
      const idx = state.messages.findIndex(
        (m) => m.role === "subagent" && m.sessionId === subSessionId,
      );
      if (idx !== -1) {
        state.messages[idx] = subagentMessage;
      }
    }
  });
}

function calculateSubagent(
  state: SessionState,
  update: SubagentUpdate,
  displayId: string,
  receivedAt: number,
): SessionState {
  return produce(state, (state) => {
    let message: SubagentMessage | undefined = state.activeSubagents.get(update.sessionId);
    if (!message) {
      message = {
        role: "subagent",
        sessionId: update.sessionId,
        name: update.name ?? "",
        prompt: update.prompt ?? "",
        status: "pending",
        messages: [],
        displayId,
        receivedAt,
      };
      state.activeSubagents.set(update.sessionId, message);
    }
    if (Object.prototype.hasOwnProperty.call(update, "name")) {
      message.name = update.name ?? "";
    }
    if (Object.prototype.hasOwnProperty.call(update, "prompt")) {
      message.prompt = update.prompt ?? "";
    }
    if (Object.prototype.hasOwnProperty.call(update, "status") && update.status != null) {
      message.status = update.status;
    }

    state.activeSubagents.set(update.sessionId, message);

    const messages = state.messages;
    const idx = messages.findIndex(
      (m) => m.role === "subagent" && m.sessionId === update.sessionId,
    );
    if (idx !== -1) {
      messages[idx] = message;
    } else {
      messages.push(message);
    }
  });
}

// ---------------------------------------------------------------------------
// Main Reducer Logic
// ---------------------------------------------------------------------------

export function reduceSessionNotification(
  sessionId: string,
  currentState: SessionState,
  notification: SessionNotificationFelloExt,
): SessionState {
  const update = notification.update;
  const displayId = notification.update._meta?.fello?.displayId ?? generateUUID();
  const receivedAt = notification.update._meta?.fello?.receivedAt ?? Date.now();

  // sessionId format is `${agentId}:${resumeId}`, extract resumeId
  const resumeId = sessionId.slice(sessionId.indexOf(":") + 1);
  const subSessionId = resumeId === notification.sessionId ? null : notification.sessionId;

  let nextState: SessionState = currentState;
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      nextState = calculateUserMessageChunk(
        currentState,
        subSessionId,
        update,
        displayId,
        receivedAt,
      );
      break;

    case "agent_message_chunk":
      nextState = calculateAgentChunk(
        currentState,
        subSessionId,
        "agent_message",
        update,
        displayId,
        receivedAt,
      );
      break;

    case "agent_thought_chunk":
      nextState = calculateAgentChunk(
        currentState,
        subSessionId,
        "agent_thought",
        update,
        displayId,
        receivedAt,
      );
      break;

    case "tool_call":
    case "tool_call_update":
      nextState = calculateToolCallUpdate(
        currentState,
        subSessionId,
        update,
        displayId,
        receivedAt,
      );
      break;

    case "plan":
      nextState = calculatePlan(currentState, subSessionId, update, displayId, receivedAt);
      break;

    case "session_info_update":
      if (
        update._meta &&
        update._meta.fello &&
        typeof update._meta.fello === "object" &&
        update._meta.fello.update &&
        typeof update._meta.fello.update === "object"
      ) {
        const addonUpdate = update._meta.fello.update;
        if (addonUpdate.sessionUpdate === "subagent_update") {
          nextState = calculateSubagent(currentState, addonUpdate, displayId, receivedAt);
        }
      }
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
  };
}
