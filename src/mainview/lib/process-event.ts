import { useAppStore } from "../store";

// Process a single ACP session update event.
export function processEvent(sessionId: string, event: Record<string, any>) {
  const store = useAppStore.getState();
  const type = event.sessionUpdate;

  switch (type) {
    case "user_message":
    case "user_message_chunk":
      if (event.content?.type === "text" && event.content.text) {
        store.addMessage(sessionId, { role: "user", content: event.content.text });
      }
      break;

    case "agent_message_chunk":
      if (event.content?.type === "text") {
        store.appendToLastMessage(sessionId, "assistant", event.content.text);
      }
      break;

    case "agent_thought_chunk":
      if (event.content?.type === "text") {
        store.appendToLastMessage(sessionId, "thinking", event.content.text);
      }
      break;

    case "tool_call":
      store.updateToolCall(sessionId, event.toolCallId, {
        title: event.title,
        status: event.status || "pending",
        content: "",
        kind: event.kind,
        rawInput: event.rawInput,
        locations: event.locations,
      });
      break;

    case "tool_call_update":
      store.updateToolCall(sessionId, event.toolCallId, {
        title: event.title,
        status: event.status || "completed",
        content: "",
        locations: event.locations,
      });
      break;

    case "usage_update":
      store.setUsage(sessionId, {
        size: event.size ?? 0,
        used: event.used ?? 0,
        cost: event.cost ?? null,
        inputTokens: event.inputTokens ?? 0,
        outputTokens: event.outputTokens ?? 0,
        totalTokens: event.totalTokens ?? 0,
        thoughtTokens: event.thoughtTokens ?? 0,
      });
      break;

    case "current_mode_update":
      store.setCurrentModeId(event.currentModeId ?? null);
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
      messages: s.messages.map((m) => {
        if (m.toolCallId && activeIds.has(m.toolCallId)) {
          const status =
            m.toolStatus === "in_progress" || m.toolStatus === "pending"
              ? "completed"
              : m.toolStatus;
          return { ...m, toolStatus: status };
        }
        return m;
      }),
    }));
  }

  store.clearToolCalls(sessionId);
  store.finalizeStreamingMessages(sessionId);
}
