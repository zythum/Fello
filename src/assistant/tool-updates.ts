import type { SessionNotification, ToolCallContent } from "@agentclientprotocol/sdk";

/** Sends a tool_call or tool_call_update to the assistant's UI. */
export type ToolUpdateSender = (update: SessionNotification["update"]) => Promise<void>;

type ToolCallStart = {
  toolCallId: string;
  title: string;
  kind: "read" | "edit" | "other";
  rawInput: unknown;
};

/**
 * What a finished tool call reports to the UI. A plain string is the common case; an array
 * lets an edit tool attach a diff next to its summary text.
 */
export type ToolSummary = string | ToolCallContent[];

/** Builds a text content block, for summaries that also carry a diff. */
export function toolText(text: string): ToolCallContent {
  return { type: "content", content: { type: "text", text } };
}

function toContent(summary: ToolSummary): ToolCallContent[] {
  return typeof summary === "string" ? [toolText(summary)] : summary;
}

/**
 * Runs a tool and reports it to the UI: in progress at the start, then completed with the
 * summary, or failed with the error message. A failure is also rethrown so the model sees it.
 */
export async function runWithToolUpdates<T>(
  sendUpdate: ToolUpdateSender,
  start: ToolCallStart,
  run: () => Promise<T>,
  summarize: (result: T) => ToolSummary,
): Promise<T> {
  await sendUpdate({
    sessionUpdate: "tool_call",
    toolCallId: start.toolCallId,
    title: start.title,
    kind: start.kind,
    status: "in_progress",
    rawInput: start.rawInput,
  });
  try {
    const result = await run();
    await sendUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: start.toolCallId,
      status: "completed",
      content: toContent(summarize(result)),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: start.toolCallId,
      status: "failed",
      content: [toolText(message)],
    });
    throw error;
  }
}
