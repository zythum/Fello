import { tool } from "ai";
import {
  SHARE_TO_USER_PROJECT_ONLY_DESCRIPTION,
  shareToUserProjectOnlyRequestSchema,
  type ShareToUserRequest,
  type ShareToUserRespond,
} from "../shared/zod/mcp-share-to-user-schema";
import { runWithToolUpdates, type ToolUpdateSender } from "./tool-updates";

/**
 * Shares one file with the user. The host binds the session context (workspace, project-only
 * restriction), so the assistant only supplies what the model chose.
 */
export type ShareToUserFn = (request: ShareToUserRequest) => Promise<ShareToUserRespond>;

/**
 * Native `share_to_user` tool. The assistant agent runs in-process, so this calls the host's
 * share implementation directly instead of going through a socket server and an MCP subprocess.
 *
 * Only workspace-relative project shares: the assistant writes a file first, then shares it.
 * 模型可见的输入 schema 与 `--project-only` 的 MCP 版本共用 shared 中的同一份定义；
 * 校验点收敛在工具边界（AI SDK 的 inputSchema），与 ask_user 一致。
 *
 * The completed call reports the same JSON payload the MCP version produced, because the chat
 * UI renders the share card from it (`fello["share-to-user"]`).
 */
export function createShareToUserTool({
  shareToUser,
  sendUpdate,
}: {
  shareToUser: ShareToUserFn;
  sendUpdate: ToolUpdateSender;
}) {
  return tool({
    // 与 session / worker 走 MCP 时同一份说明（projectOnly 版）。
    description: SHARE_TO_USER_PROJECT_ONLY_DESCRIPTION,
    inputSchema: shareToUserProjectOnlyRequestSchema,
    execute: async (input, { toolCallId }) =>
      runWithToolUpdates(
        sendUpdate,
        { toolCallId, title: `Share ${input.name}`, kind: "other", rawInput: input },
        async () => {
          const respond = await shareToUser(input);
          return { ok: true as const, fello: { "share-to-user": respond } };
        },
        (result) => JSON.stringify(result),
      ),
  });
}
