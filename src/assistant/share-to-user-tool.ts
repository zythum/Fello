import { tool } from "ai";
import { z } from "zod";
import {
  SHARE_TO_USER_PROJECT_ONLY_DESCRIPTION,
  shareToUserRequestSchema,
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
 * Only workspace-relative project shares: the assistant writes a file first, then shares it.
 * 与 ask_user 一致，模型可见的输入 schema 由工具自己声明（收窄到 project）；
 * 进入宿主前仍用共享 schema 校验一次，保持与会话 / worker 走 MCP 时同一份契约。
 */
const inputSchema = z.object({
  type: z.literal("project").describe("Only workspace-relative project shares are supported."),
  uri: z
    .string()
    .min(1)
    .describe("Workspace-relative path of an existing file in your workspace."),
  name: z
    .string()
    .min(1)
    .describe("Filename shown to the user, for example 'report.pdf'. Include the extension."),
  mimeType: z
    .string()
    .optional()
    .describe("MIME type (e.g. 'image/png', 'application/pdf'). If omitted, inferred from name."),
});

/**
 * Native `share_to_user` tool. The assistant agent runs in-process, so this calls the host's
 * share implementation directly instead of going through a socket server and an MCP subprocess.
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
    inputSchema,
    execute: async (input, { toolCallId }) =>
      runWithToolUpdates(
        sendUpdate,
        { toolCallId, title: `Share ${input.name}`, kind: "other", rawInput: input },
        async () => {
          const respond = await shareToUser(shareToUserRequestSchema.parse(input));
          return { ok: true as const, fello: { "share-to-user": respond } };
        },
        (result) => JSON.stringify(result),
      ),
  });
}
