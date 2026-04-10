import type { SessionNotification } from "@agentclientprotocol/sdk";
import { useAppStore } from "../store";

// Process a single ACP session update event.
export function processEvent(sessionId: string, { update }: SessionNotification) {
  const store = useAppStore.getState();

  const type = update.sessionUpdate;

  switch (type) {
    case "user_message_chunk":
      if (update.content) {
        store.addMessage(sessionId, { role: "user_message", contents: [update.content] });
      }
      break;

    case "agent_message_chunk":
      if (update.content) {
        store.appendToLastMessage(sessionId, "agent_message", update.content);
      }
      break;

    case "agent_thought_chunk":
      if (update.content) {
        store.appendToLastMessage(sessionId, "agent_thought", update.content);
      }
      break;

    case "tool_call": {
      let terminalId: string | null = null;
      if (Array.isArray(update.content)) {
        for (const content of update.content) {
          if (content.type === "terminal") {
            terminalId = content.terminalId;
          }
        }
      }
      store.updateToolCall(sessionId, update.toolCallId, {
        title: update.title,
        status: update.status || "completed",
        content: update.content || [],
        kind: update.kind,
        terminalId,
        rawInput: update.rawInput,
        locations: update.locations,
      });
      break;
    }

    case "tool_call_update": {
      let terminalId: string | null = null;
      if (Array.isArray(update.content)) {
        for (const content of update.content) {
          if (content.type === "terminal") {
            terminalId = content.terminalId;
          }
        }
      }
      const updateData: any = {
        title: update.title,
        status: update.status || "completed",
        content: update.content || [],
        locations: update.locations,
      };
      if (terminalId) updateData.terminalId = terminalId;
      store.updateToolCall(sessionId, update.toolCallId, updateData);
      break;
    }

    case "usage_update":
      store.setUsage(sessionId, {
        size: update.size ?? 0,
        used: update.used ?? 0,
        cost: update.cost ?? null,
      });
      break;

    case "current_mode_update":
      store.setCurrentModeId(update.currentModeId ?? null);
      break;

    default:
      break;
  }
}

// Flush streaming content and tool calls into messages array.
// Called when a prompt turn ends.
export function flushStreaming(sessionId: string) {
  const store = useAppStore.getState();
  const ss = store.getSessionState(sessionId);

  // Finalize any in-progress tool messages already in the messages array
  if (ss.activeToolCalls.size > 0) {
    const activeIds = new Set(ss.activeToolCalls.keys());
    store.updateSessionState(sessionId, (s) => ({
      messages: s.messages.map((m: any) => {
        if (m.role === "tool_call" && m.toolCallId && activeIds.has(m.toolCallId)) {
          const status =
            m.status === "in_progress" || m.status === "pending" ? "completed" : m.status;
          return { ...m, status };
        }
        return m;
      }),
    }));
  }

  store.clearToolCalls(sessionId);
  store.finalizeStreamingMessages(sessionId);
}
