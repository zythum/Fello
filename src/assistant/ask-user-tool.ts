import { tool } from "ai";
import {
  ASK_USER_TOOL_DESCRIPTION,
  askUserAskRequestSchema,
  type AskUserAskRequest,
} from "../shared/zod/mcp-ask-user-schema";
import { runWithToolUpdates, type ToolUpdateSender } from "./tool-updates";

export type AskUserToolResult = { value: string | null; reason: string | null };

export type AskUserFn = (options: AskUserAskRequest) => Promise<AskUserToolResult>;

/** Asks the user directly. `reason` carries free-form input or the timeout marker. */
export function createAskUserTool({
  askUser,
  sendUpdate,
}: {
  askUser: AskUserFn;
  sendUpdate: ToolUpdateSender;
}) {
  return tool({
    // 与 session / worker 走 MCP 时同一份说明与输入 schema：工具面与跨进程契约只有一个定义。
    description: ASK_USER_TOOL_DESCRIPTION,
    inputSchema: askUserAskRequestSchema,
    execute: async (input, { toolCallId }) =>
      runWithToolUpdates(
        sendUpdate,
        {
          toolCallId,
          title: `Ask user: ${input.title}`,
          kind: "other",
          rawInput: { title: input.title, options: input.options.map((option) => option.value) },
        },
        async () => {
          const result = await askUser(input);
          const timedOut = result.reason === "timeout";
          const answer = timedOut ? null : result.value !== null ? result.value : result.reason;
          return { answer, timedOut, selected: result.value };
        },
        (result) => {
          if (result.timedOut) return "The user did not answer (timeout).";
          if (result.answer === null) return "The user cancelled.";
          return `User answered: ${result.answer}`;
        },
      ),
  });
}
