import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentClientProxy } from "./agent-client-proxy";
import { normalizeSessionTitle } from "../shared/session-title";

export type SessionTitleToolParams = {
  /** ACP session id (the resume id of the current session). */
  sessionId: string;
  /** Get the current ACP connection. */
  getConnection: () => AgentClientProxy | null;
};

/**
 * Guidance appended to the API agent's system prompt next to this tool.
 * Kept next to the tool so the wording and the tool name cannot drift apart.
 */
export const SESSION_TITLE_PROMPT = `

Session title:
- The session title is shown in the sidebar, so it should describe what this conversation is about, not what is happening right now.
- It is generated automatically from the first message. When the conversation clearly moves on to a different subject (a new task or a new area of the codebase), call SetSessionTitle with a short title of 3-10 words in the same language the user writes in.
- Do not rename the session on every turn, and never use it for progress updates.
- If the user renamed the session by hand, the request is silently ignored by the app; do not retry.`;

/**
 * `SetSessionTitle` lets the API agent rename its own session on demand.
 *
 * The title travels as a standard ACP `session_info_update`, so the backend applies it
 * through the same path as every other agent-driven title (and can ignore it when the user
 * has set their own title). No extra IPC or backend tool is involved.
 */
export function createSessionTitleTool(params: SessionTitleToolParams): ToolSet {
  const setSessionTitle = tool({
    description: `Rename the current chat session.

Call this only when the conversation has clearly moved on to a different subject, so the sidebar keeps showing a title that matches what the session is about.

The title travels as a standard ACP session_info_update, so the app applies the same rules as for any agent-generated title: a title the user set by hand always wins, in which case this request is ignored.`,
    inputSchema: z.object({
      title: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe(
          "New session title: 3-10 words, same language as the user, no quotes, no trailing punctuation.",
        ),
    }),
    execute: async ({ title }, { toolCallId }) => {
      const connection = params.getConnection();
      const nextTitle = normalizeSessionTitle(title);
      if (!connection || !nextTitle) {
        return "Session title was not changed.";
      }

      // Broadcast tool_call first so the rename is visible in the timeline, then send the
      // title itself (the backend intercepts session_info_update with a title).
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: `Set session title: ${nextTitle}`,
          kind: "edit",
          status: "in_progress",
          rawInput: { title: nextTitle },
        },
      });
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: "session_info_update", title: nextTitle },
      });
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: `Session title set to "${nextTitle}".` },
            },
          ],
        },
      });
      return `Session title requested: "${nextTitle}".`;
    },
  });

  return { SetSessionTitle: setSessionTitle };
}
