import { z } from "zod";

const imageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/avif",
] as const;

/**
 * shareToUser 输入 schema — 当前仅支持图片。
 */
export const shareToUserRequestSchema = z
  .object({
    type: z
      .enum(["link", "base64"])
      .describe(
        "How the image is provided: 'link' (file://, https://, or http:// URL) or 'base64' (inline data).",
      ),
    uri: z
      .string()
      .optional()
      .describe(
        "Image URI. Supports file:// (local file), https://, or http:// URLs. Required when type='link'.",
      ),
    data: z.string().optional().describe("Base64-encoded image data. Required when type='base64'."),
    name: z.string().describe("Image filename (e.g. 'diagram.png', 'screenshot.jpg')."),
    mimeType: z
      .enum(imageMimeTypes)
      .optional()
      .describe("Image MIME type. If omitted, inferred from filename extension."),
    description: z.string().optional().describe("Optional caption for the image."),
  })
  .refine((data) => (data.type === "link" ? !!data.uri : !!data.data), {
    message: "uri is required when type='link', data is required when type='base64'",
  });

export const shareToUserRespondSchema = z.object({
  sharePath: z
    .string()
    .describe("Relative path in the session's share directory (e.g. '<shareId>/<filename>')."),
  name: z.string().describe("Original filename of the shared image."),
  mimeType: z.string().optional().describe("Image MIME type (e.g. 'image/jpeg', 'image/png')."),
});

export type ShareToUserRespond = z.infer<typeof shareToUserRespondSchema>;
