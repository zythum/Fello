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

    default:
      break;
  }
}

// Flush streaming content and tool calls into messages array.
// Called when a prompt turn ends.
export function flushStreaming(sessionId: string) {
  const store = useAppStore.getState();
  const ss = store.getSessionState(sessionId);

  for (const [id, tc] of ss.activeToolCalls) {
    store.addMessage(sessionId, {
      role: "tool",
      content: "",
      toolCallId: id,
      toolTitle: tc.title,
      toolStatus: tc.status === "in_progress" || tc.status === "pending" ? "completed" : tc.status,
      toolKind: tc.kind,
      rawInput: tc.rawInput,
      locations: tc.locations,
    });
  }
  store.clearToolCalls(sessionId);
  store.finalizeStreamingMessages(sessionId);
}
