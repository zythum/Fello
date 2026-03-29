import { useAppStore, type ChatMessage, type SessionUsage } from "../store";

// Process a single ACP session update event.
// Used both for real-time streaming and replaying from JSONL.
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
      });
      break;

    default:
      break;
  }
}

// Flush streaming content and tool calls into messages array.
// Called when a prompt turn ends or before displaying loaded history.
export function flushStreaming(sessionId: string) {
  const store = useAppStore.getState();
  const ss = store.getSessionState(sessionId);

  // Flush active tool calls into messages
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

  // Mark any streaming messages as finalized
  store.finalizeStreamingMessages(sessionId);
}

interface ToolCallAccum {
  title: string;
  status: string;
  content: string;
  kind?: string | null;
  rawInput?: unknown;
  locations?: Array<{ path: string; line?: number | null }> | null;
}

// Append chunk to the last message in-place (mutates the array for perf).
function appendChunk(msgs: ChatMessage[], role: "assistant" | "thinking", text: string) {
  const last = msgs[msgs.length - 1];
  if (last && last.role === role && last.streaming) {
    last.content += text;
  } else {
    // Finalize prior streaming messages
    for (const m of msgs) {
      if (m.streaming) m.streaming = false;
    }
    msgs.push({ role, content: text, streaming: true });
  }
}

// Batch-replay all events in memory, then write to store ONCE.
// This avoids N store updates (and N re-renders) when resuming a session.
export function replayEvents(sessionId: string, events: unknown[]) {
  const msgs: ChatMessage[] = [];
  const toolCalls = new Map<string, ToolCallAccum>();
  let usage: SessionUsage | null = null;

  for (const raw of events) {
    const event = raw as Record<string, any>;
    const type = event.sessionUpdate;

    switch (type) {
      case "user_message":
      case "user_message_chunk":
        if (event.content?.type === "text" && event.content.text) {
          msgs.push({ role: "user", content: event.content.text });
        }
        break;

      case "agent_message_chunk":
        if (event.content?.type === "text") {
          appendChunk(msgs, "assistant", event.content.text);
        }
        break;

      case "agent_thought_chunk":
        if (event.content?.type === "text") {
          appendChunk(msgs, "thinking", event.content.text);
        }
        break;

      case "tool_call": {
        const existing = toolCalls.get(event.toolCallId);
        toolCalls.set(event.toolCallId, {
          title: event.title ?? existing?.title ?? "",
          status: event.status || "pending",
          content: "",
          kind: event.kind ?? existing?.kind,
          rawInput: event.rawInput ?? existing?.rawInput,
          locations: event.locations ?? existing?.locations,
        });
        break;
      }

      case "tool_call_update": {
        const existing = toolCalls.get(event.toolCallId);
        toolCalls.set(event.toolCallId, {
          title: event.title ?? existing?.title ?? "",
          status: event.status || "completed",
          content: "",
          kind: existing?.kind,
          rawInput: existing?.rawInput,
          locations: event.locations ?? existing?.locations,
        });
        break;
      }

      case "usage_update":
        usage = {
          size: event.size ?? 0,
          used: event.used ?? 0,
          cost: event.cost ?? null,
        };
        break;

      default:
        break;
    }
  }

  // Flush tool calls into messages
  for (const [id, tc] of toolCalls) {
    msgs.push({
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

  // Finalize any streaming messages
  for (const m of msgs) {
    if (m.streaming) m.streaming = false;
  }

  // Single store update — one render
  const store = useAppStore.getState();
  store.updateSessionState(sessionId, () => ({
    messages: msgs,
    usage,
    isStreaming: false,
    permissionRequests: [],
    activeToolCalls: new Map(),
  }));
}
