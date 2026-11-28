import { z } from "zod";

export { isImageMimeType } from "../constants";

// ── MCP Server ───────────────────────────────────────────────────────

export const SHARE_TO_USER_SERVER_DESCRIPTION =
  "Share files (images, documents, etc.) directly to the user's chat area. Supports image preview and file cards.";

// ── share_to_user ────────────────────────────────────────────────────

/**
 * share_to_user 工具的模型可见说明。
 * 会话 / worker 走 MCP（可分享任意文件），个人助理走进程内工具（只允许 project），两处共用文案。
 */
export const SHARE_TO_USER_TOOL_DESCRIPTION = `Share a file to the user's chat area for them to see. Supports images (with preview), PDFs, documents, and any file type (shown as a file card).
Provide the file as a file:// URI, https:// URL, base64-encoded data, or a project-relative path (zero-copy).`;

/** projectOnly 场景（个人助理等受限调用方）的说明。 */
export const SHARE_TO_USER_PROJECT_ONLY_DESCRIPTION = `Share a file that already exists in your workspace with the user. Write the file first, then pass type="project" and its workspace-relative path. Link/base64 sharing is not available.`;

/**
 * shareToUser 输入 schema — 支持图片和任意文件。
 *
 * type:
 *   - 'link': file://, https://, or http:// URL
 *   - 'base64': inline base64-encoded data
 *   - 'project': 项目内相对路径（零拷贝，直接引用项目文件）
 */
export const shareToUserRequestSchema = z
  .object({
    type: z
      .enum(["link", "base64", "project"])
      .describe(
        "How the file is provided: 'link' (file://, https://, or http:// URL), 'base64' (inline data), or 'project' (relative path within the project directory, zero-copy).",
      ),
    uri: z
      .string()
      .min(1)
      .optional()
      .describe(
        "File URI. Supports file:// (local file), https://, or http:// URLs. Required when type='link'. When type='project', this is the relative path within the project directory.",
      ),
    data: z.string().optional().describe("Base64-encoded file data. Required when type='base64'."),
    name: z.string().min(1).describe("Filename (e.g. 'diagram.png', 'report.pdf', 'output.csv')."),
    mimeType: z
      .string()
      .optional()
      .describe(
        "MIME type (e.g. 'image/png', 'application/pdf'). If omitted, inferred from filename extension.",
      ),
  })
  .refine(
    (data) => {
      if (data.type === "link" || data.type === "project") return !!data.uri;
      if (data.type === "base64") return !!data.data;
      return false;
    },
    {
      message:
        "uri is required when type='link' or type='project', data is required when type='base64'",
    },
  );

export type ShareToUserRequest = z.infer<typeof shareToUserRequestSchema>;

/**
 * projectOnly 场景的输入 schema：只允许工作区内的 project 分享（零拷贝）。
 * 个人助理的进程内工具与 `--project-only` 的 MCP 子进程共用，避免两侧收窄方式不一致。
 */
export const shareToUserProjectOnlyRequestSchema = z.object({
  type: z.literal("project").describe("Only workspace-relative project shares are supported."),
  uri: z.string().min(1).describe("Workspace-relative path of an existing file in your workspace."),
  name: z
    .string()
    .min(1)
    .describe("Filename shown to the user, for example 'report.pdf'. Include the extension."),
  mimeType: z
    .string()
    .optional()
    .describe("MIME type (e.g. 'image/png', 'application/pdf'). If omitted, inferred from name."),
});

export type ShareToUserProjectOnlyRequest = z.infer<typeof shareToUserProjectOnlyRequestSchema>;

export const shareToUserRespondSchema = z.object({
  sharePath: z
    .string()
    .optional()
    .describe(
      "Relative path in the session's share directory. Present when type is 'link' or 'base64'.",
    ),
  projectPath: z
    .string()
    .optional()
    .describe("Relative path within the project directory. Present when type is 'project'."),
  name: z.string().describe("Original filename of the shared file."),
  mimeType: z.string().optional().describe("MIME type (e.g. 'image/png', 'application/pdf')."),
});

export type ShareToUserRespond = z.infer<typeof shareToUserRespondSchema>;
