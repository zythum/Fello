import { z } from "zod";

// ── Base64 Encode ────────────────────────────────────────────────────

export const base64EncodeRequestSchema = z.object({
  text: z.string().describe("The text string to encode into Base64."),
});

export const base64EncodeRespondSchema = z.object({
  result: z.string(),
});

export type Base64EncodeRequest = z.infer<typeof base64EncodeRequestSchema>;
export type Base64EncodeRespond = z.infer<typeof base64EncodeRespondSchema>;

// ── Base64 Decode ────────────────────────────────────────────────────

export const base64DecodeRequestSchema = z.object({
  base64: z.string().describe("The Base64-encoded string to decode back into text."),
});

export const base64DecodeRespondSchema = z.object({
  result: z.string(),
});

export type Base64DecodeRequest = z.infer<typeof base64DecodeRequestSchema>;
export type Base64DecodeRespond = z.infer<typeof base64DecodeRespondSchema>;

// ── URL Encode ───────────────────────────────────────────────────────

export const urlEncodeRequestSchema = z.object({
  text: z.string().describe("The text string to URL-encode."),
});

export const urlEncodeRespondSchema = z.object({
  result: z.string(),
});

export type UrlEncodeRequest = z.infer<typeof urlEncodeRequestSchema>;
export type UrlEncodeRespond = z.infer<typeof urlEncodeRespondSchema>;

// ── URL Decode ───────────────────────────────────────────────────────

export const urlDecodeRequestSchema = z.object({
  text: z.string().describe("The URL-encoded string to decode."),
});

export const urlDecodeRespondSchema = z.object({
  result: z.string(),
});

export type UrlDecodeRequest = z.infer<typeof urlDecodeRequestSchema>;
export type UrlDecodeRespond = z.infer<typeof urlDecodeRespondSchema>;

// ── Hash ─────────────────────────────────────────────────────────────

export const hashRequestSchema = z.object({
  text: z.string().describe("The text to hash."),
  algorithm: z
    .enum(["md5", "sha1", "sha256"])
    .default("sha256")
    .describe("Hash algorithm: md5, sha1, or sha256. Default: sha256."),
});

export const hashRespondSchema = z.object({
  result: z.string(),
});

export type HashRequest = z.infer<typeof hashRequestSchema>;
export type HashRespond = z.infer<typeof hashRespondSchema>;

// ── Time ─────────────────────────────────────────────────────────────

export const timeRequestSchema = z.object({
  format: z
    .enum(["iso", "timestamp"])
    .default("iso")
    .describe(
      "Output format: 'iso' for ISO 8601 string, 'timestamp' for Unix timestamp in seconds.",
    ),
});

export const timeRespondSchema = z.object({
  result: z.union([z.string(), z.number()]),
});

export type TimeRequest = z.infer<typeof timeRequestSchema>;
export type TimeRespond = z.infer<typeof timeRespondSchema>;

// ── UUID ─────────────────────────────────────────────────────────────

export const uuidRequestSchema = z.object({});

export const uuidRespondSchema = z.object({
  result: z.string(),
});

export type UuidRequest = z.infer<typeof uuidRequestSchema>;
export type UuidRespond = z.infer<typeof uuidRespondSchema>;

// ── Short ID ─────────────────────────────────────────────────────────

export const shortIdRequestSchema = z.object({
  length: z
    .number()
    .int()
    .min(4)
    .max(32)
    .default(8)
    .describe("Length of the short ID (4-32). Default: 8."),
});

export const shortIdRespondSchema = z.object({
  result: z.string(),
});

export type ShortIdRequest = z.infer<typeof shortIdRequestSchema>;
export type ShortIdRespond = z.infer<typeof shortIdRespondSchema>;

// ── Random ───────────────────────────────────────────────────────────

export const randomRequestSchema = z.object({
  length: z
    .number()
    .int()
    .min(1)
    .max(256)
    .default(16)
    .describe("Length of the random string (1-256). Default: 16."),
  charset: z
    .enum(["alphanumeric", "alpha", "numeric", "hex"])
    .default("alphanumeric")
    .describe("Character set: alphanumeric, alpha, numeric, or hex. Default: alphanumeric."),
});

export const randomRespondSchema = z.object({
  result: z.string(),
});

export type RandomRequest = z.infer<typeof randomRequestSchema>;
export type RandomRespond = z.infer<typeof randomRespondSchema>;

// ── RandInt ──────────────────────────────────────────────────────────

export const randIntRequestSchema = z.object({
  min: z.number().int().describe("Minimum value (inclusive)."),
  max: z.number().int().describe("Maximum value (inclusive)."),
});

export const randIntRespondSchema = z.object({
  result: z.number().int(),
});

export type RandIntRequest = z.infer<typeof randIntRequestSchema>;
export type RandIntRespond = z.infer<typeof randIntRespondSchema>;

// ── Choice ───────────────────────────────────────────────────────────

export const choiceRequestSchema = z.object({
  items: z.array(z.string()).min(1).describe("Array of items to choose from."),
});

export const choiceRespondSchema = z.object({
  result: z.string(),
});

export type ChoiceRequest = z.infer<typeof choiceRequestSchema>;
export type ChoiceRespond = z.infer<typeof choiceRespondSchema>;

// ── Shuffle ──────────────────────────────────────────────────────────

export const shuffleRequestSchema = z.object({
  items: z.array(z.string()).min(1).describe("Array of items to shuffle."),
});

export const shuffleRespondSchema = z.object({
  result: z.array(z.string()),
});

export type ShuffleRequest = z.infer<typeof shuffleRequestSchema>;
export type ShuffleRespond = z.infer<typeof shuffleRespondSchema>;

// ── Image Metadata ───────────────────────────────────────────────────

export const imageMetadataRequestSchema = z.object({
  path: z.string().describe("Absolute or project-relative path to the image file."),
});

export const imageMetadataRespondSchema = z.object({
  result: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    format: z.string().optional(),
    space: z.string().optional(),
    channels: z.number().optional(),
    depth: z.string().optional(),
    density: z.number().optional(),
    hasAlpha: z.boolean().optional(),
    size: z.number().optional(),
  }),
});

export type ImageMetadataRequest = z.infer<typeof imageMetadataRequestSchema>;
export type ImageMetadataRespond = z.infer<typeof imageMetadataRespondSchema>;

// ── Image Thumbnail ──────────────────────────────────────────────────

export const imageThumbnailRequestSchema = z.object({
  path: z.string().describe("Absolute or project-relative path to the source image."),
  width: z
    .number()
    .int()
    .min(1)
    .max(1024)
    .default(200)
    .describe("Thumbnail width in pixels (1-1024). Default: 200."),
  output: z
    .string()
    .optional()
    .describe("Output path. If omitted, saves alongside source with '.thumb{width}' suffix."),
});

export const imageThumbnailRespondSchema = z.object({
  result: z.object({
    output: z.string(),
    metadata: imageMetadataRespondSchema.shape.result,
  }),
});

export type ImageThumbnailRequest = z.infer<typeof imageThumbnailRequestSchema>;
export type ImageThumbnailRespond = z.infer<typeof imageThumbnailRespondSchema>;

// ── Image Resize ─────────────────────────────────────────────────────

export const imageResizeRequestSchema = z.object({
  path: z.string().describe("Absolute or project-relative path to the source image."),
  width: z.number().int().min(1).optional().describe("Target width in pixels."),
  height: z.number().int().min(1).optional().describe("Target height in pixels."),
  fit: z
    .enum(["cover", "contain", "fill", "inside", "outside"])
    .default("inside")
    .describe("How to fit the image: cover, contain, fill, inside, outside. Default: inside."),
  output: z.string().optional().describe("Output path. If omitted, saves alongside source with '.{width}x{height}' suffix."),
});

export const imageResizeRespondSchema = z.object({
  result: z.object({
    output: z.string(),
    metadata: imageMetadataRespondSchema.shape.result,
  }),
});

export type ImageResizeRequest = z.infer<typeof imageResizeRequestSchema>;
export type ImageResizeRespond = z.infer<typeof imageResizeRespondSchema>;

// ── Image Convert ────────────────────────────────────────────────────

export const imageConvertRequestSchema = z.object({
  path: z.string().describe("Absolute or project-relative path to the source image."),
  format: z.enum(["jpeg", "png", "webp", "avif", "tiff"]).describe("Target image format."),
  quality: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Quality for lossy formats (1-100). Applies to jpeg, webp, avif."),
  output: z
    .string()
    .optional()
    .describe("Output path. If omitted, saves alongside source with new extension."),
});

export const imageConvertRespondSchema = z.object({
  result: z.object({
    output: z.string(),
    metadata: imageMetadataRespondSchema.shape.result,
  }),
});

export type ImageConvertRequest = z.infer<typeof imageConvertRequestSchema>;
export type ImageConvertRespond = z.infer<typeof imageConvertRespondSchema>;
