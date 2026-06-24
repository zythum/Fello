import { z } from "zod";

export { isImageMimeType } from "../constants";

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
      .optional()
      .describe(
        "File URI. Supports file:// (local file), https://, or http:// URLs. Required when type='link'. When type='project', this is the relative path within the project directory.",
      ),
    data: z.string().optional().describe("Base64-encoded file data. Required when type='base64'."),
    name: z.string().describe("Filename (e.g. 'diagram.png', 'report.pdf', 'output.csv')."),
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
