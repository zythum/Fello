import { useAppStore } from "../store";

// Process a single ACP session update event.
// Used both for real-time streaming and replaying from JSONL.
export function processEvent(event: Record<string, any>) {
  const store = useAppStore.getState();
  const type = event.sessionUpdate;

  switch (type) {
    case "user_message":
    case "user_message_chunk":
      if (event.content?.type === "text" && event.content.text) {
        store.addMessage({ role: "user", content: event.content.text });
      }
      break;

    case "agent_message_chunk":
      if (event.content?.type === "text") {
        store.appendStreamingContent(event.content.text);
      }
      break;

    case "agent_thought_chunk":
      if (event.content?.type === "text") {
        store.appendThinkingContent(event.content.text);
      }
      break;

    case "tool_call":
      store.updateToolCall(event.toolCallId, {
        title: event.title,
        status: event.status || "pending",
        content: "",
        kind: event.kind,
        rawInput: event.rawInput,
        locations: event.locations,
      });
      break;

    case "tool_call_update":
      store.updateToolCall(event.toolCallId, {
        title: event.title,
        status: event.status || "completed",
        content: "",
        locations: event.locations,
      });
      break;

    case "usage_update":
      store.setUsage({
        inputTokens: event.usage?.inputTokens ?? 0,
        outputTokens: event.usage?.outputTokens ?? 0,
        totalTokens: event.usage?.totalTokens ?? 0,
        thoughtTokens: event.usage?.thoughtTokens,
        cachedReadTokens: event.usage?.cachedReadTokens,
        cachedWriteTokens: event.usage?.cachedWriteTokens,
      });
      break;

    default:
      break;
  }
}

// Flush streaming content and tool calls into messages array.
// Called when a prompt turn ends or before displaying loaded history.
export function flushStreaming() {
  const store = useAppStore.getState();

  // Flush tool calls into messages
  const toolCalls = store.activeToolCalls;
  for (const [id, tc] of toolCalls) {
    store.addMessage({
      role: "tool",
      content: "",
      toolCallId: id,
      toolTitle: tc.title,
      toolStatus: tc.status === "in_progress" || tc.status === "pending"
        ? "completed" : tc.status,
      toolKind: tc.kind,
      rawInput: tc.rawInput,
      locations: tc.locations,
    });
  }
  store.clearToolCalls();

  // Flush streaming content into assistant message
  const content = store.streamingContent;
  if (content) {
    store.addMessage({ role: "assistant", content });
  }
  store.setStreamingContent("");
  store.setThinkingContent("");
}

// Replay a list of events from JSONL into the store.
// Resets messages first, then processes each event, then flushes.
export function replayEvents(events: unknown[]) {
  const store = useAppStore.getState();
  store.setMessages([]);
  store.setStreamingContent("");
  store.setThinkingContent("");
  store.clearToolCalls();
  store.setUsage(null);

  for (const ev of events) {
    processEvent(ev as Record<string, any>);
  }

  flushStreaming();
}
