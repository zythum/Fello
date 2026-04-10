import { useAppStore } from "../store";

// Process a single ACP session update event.
export function processEvent(sessionId: string, event: Record<string, any>) {
  const store = useAppStore.getState();
  const type = event.sessionUpdate;

  switch (type) {
    case "user_message_chunk":
      if (event.content) {
        store.addMessage(sessionId, { role: "user_message", contents: [event.content] });
      }
      break;

    case "agent_message_chunk":
      if (event.content) {
        store.appendToLastMessage(sessionId, "agent_message", event.content);
      }
      break;

    case "agent_thought_chunk":
      if (event.content) {
        store.appendToLastMessage(sessionId, "agent_thought", event.content);
      }
      break;

    case "tool_call": {
      let terminalId: string | null = null;
      if (Array.isArray(event.content)) {
        const termContent = event.content.find((c: any) => c.type === "terminal");
        if (termContent) terminalId = termContent.terminalId;
      }
      store.updateToolCall(sessionId, event.toolCallId, {
        title: event.title,
        status: event.status || "completed",
        content: event.content || [],
        kind: event.kind,
        terminalId,
        rawInput: event.rawInput,
        locations: event.locations,
      });
      break;
    }

    case "tool_call_update": {
      let terminalId: string | null = null;
      if (Array.isArray(event.content)) {
        const termContent = event.content.find((c: any) => c.type === "terminal");
        if (termContent) terminalId = termContent.terminalId;
      }
      const updateData: any = {
        title: event.title,
        status: event.status || "completed",
        content: event.content || [],
        locations: event.locations,
      };
      if (terminalId) updateData.terminalId = terminalId;
      store.updateToolCall(sessionId, event.toolCallId, updateData);
      break;
    }

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
      messages: s.messages.map((m: any) => {
        if (m.role === 'tool_call' && m.toolCallId && activeIds.has(m.toolCallId)) {
          const status =
            m.status === "in_progress" || m.status === "pending"
              ? "completed"
              : m.status;
          return { ...m, status };
        }
        return m;
      }),
    }));
  }

  store.clearToolCalls(sessionId);
  store.finalizeStreamingMessages(sessionId);
}
