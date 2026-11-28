import { z } from "zod";

// ── MCP Server ───────────────────────────────────────────────────────

export const TOOLBOX_SERVER_DESCRIPTION =
  "Built-in utility tools: base64, URL encode/decode, hash, time, UUID, random, image processing, QR code, audio file transcription, text to speech, etc.";

// ── Base64 Encode ────────────────────────────────────────────────────

export const BASE64_ENCODE_TOOL_DESCRIPTION =
  "Encode a text string into Base64 format. Supports UTF-8 text.";

export const base64EncodeRequestSchema = z.object({
  text: z.string().describe("The text string to encode into Base64."),
});

export const base64EncodeRespondSchema = z.object({
  result: z.string(),
});

export type Base64EncodeRequest = z.infer<typeof base64EncodeRequestSchema>;
export type Base64EncodeRespond = z.infer<typeof base64EncodeRespondSchema>;

// ── Base64 Decode ────────────────────────────────────────────────────

export const BASE64_DECODE_TOOL_DESCRIPTION =
  "Decode a Base64-encoded string back into UTF-8 text.";

export const base64DecodeRequestSchema = z.object({
  base64: z.string().describe("The Base64-encoded string to decode back into text."),
});

export const base64DecodeRespondSchema = z.object({
  result: z.string(),
});

export type Base64DecodeRequest = z.infer<typeof base64DecodeRequestSchema>;
export type Base64DecodeRespond = z.infer<typeof base64DecodeRespondSchema>;

// ── URL Encode ───────────────────────────────────────────────────────

export const URL_ENCODE_TOOL_DESCRIPTION = "URL-encode a text string (percent-encoding).";

export const urlEncodeRequestSchema = z.object({
  text: z.string().describe("The text string to URL-encode."),
});

export const urlEncodeRespondSchema = z.object({
  result: z.string(),
});

export type UrlEncodeRequest = z.infer<typeof urlEncodeRequestSchema>;
export type UrlEncodeRespond = z.infer<typeof urlEncodeRespondSchema>;

// ── URL Decode ───────────────────────────────────────────────────────

export const URL_DECODE_TOOL_DESCRIPTION =
  "Decode a URL-encoded (percent-encoded) string back into text.";

export const urlDecodeRequestSchema = z.object({
  text: z.string().describe("The URL-encoded string to decode."),
});

export const urlDecodeRespondSchema = z.object({
  result: z.string(),
});

export type UrlDecodeRequest = z.infer<typeof urlDecodeRequestSchema>;
export type UrlDecodeRespond = z.infer<typeof urlDecodeRespondSchema>;

// ── Hash ─────────────────────────────────────────────────────────────

export const HASH_TOOL_DESCRIPTION =
  "Compute a hash (MD5, SHA1, or SHA256) of a text string. Returns hex digest.";

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

export const TIME_TOOL_DESCRIPTION =
  "Get the current time. Returns either an ISO 8601 string or a Unix timestamp in seconds.";

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

export const UUID_TOOL_DESCRIPTION = "Generate a random UUID v4.";

export const uuidRequestSchema = z.object({});

export const uuidRespondSchema = z.object({
  result: z.string(),
});

export type UuidRequest = z.infer<typeof uuidRequestSchema>;
export type UuidRespond = z.infer<typeof uuidRespondSchema>;

// ── Short ID ─────────────────────────────────────────────────────────

export const SHORT_ID_TOOL_DESCRIPTION = "Generate a short random alphanumeric ID.";

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

export const RANDOM_TOOL_DESCRIPTION =
  "Generate a random string with specified length and character set.";

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

export const RAND_INT_TOOL_DESCRIPTION =
  "Generate a random integer between min and max (inclusive).";

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

export const CHOICE_TOOL_DESCRIPTION = "Pick a random item from an array.";

export const choiceRequestSchema = z.object({
  items: z.array(z.string()).min(1).describe("Array of items to choose from."),
});

export const choiceRespondSchema = z.object({
  result: z.string(),
});

export type ChoiceRequest = z.infer<typeof choiceRequestSchema>;
export type ChoiceRespond = z.infer<typeof choiceRespondSchema>;

// ── Shuffle ──────────────────────────────────────────────────────────

export const SHUFFLE_TOOL_DESCRIPTION = "Shuffle an array randomly (Fisher-Yates).";

export const shuffleRequestSchema = z.object({
  items: z.array(z.string()).min(1).describe("Array of items to shuffle."),
});

export const shuffleRespondSchema = z.object({
  result: z.array(z.string()),
});

export type ShuffleRequest = z.infer<typeof shuffleRequestSchema>;
export type ShuffleRespond = z.infer<typeof shuffleRespondSchema>;

// ── Image Metadata ───────────────────────────────────────────────────

export const IMAGE_METADATA_TOOL_DESCRIPTION =
  "Read image metadata (width, height, format, color space, channels, etc.) from a file.";

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

export const IMAGE_THUMBNAIL_TOOL_DESCRIPTION =
  "Generate a thumbnail from an image. Returns the output file path and new image metadata.";

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

export const IMAGE_RESIZE_TOOL_DESCRIPTION =
  "Resize an image to specified dimensions. Returns the output file path and new image metadata.";

export const imageResizeRequestSchema = z.object({
  path: z.string().describe("Absolute or project-relative path to the source image."),
  width: z.number().int().min(1).optional().describe("Target width in pixels."),
  height: z.number().int().min(1).optional().describe("Target height in pixels."),
  fit: z
    .enum(["cover", "contain", "fill", "inside", "outside"])
    .default("inside")
    .describe("How to fit the image: cover, contain, fill, inside, outside. Default: inside."),
  output: z
    .string()
    .optional()
    .describe("Output path. If omitted, saves alongside source with '.{width}x{height}' suffix."),
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

export const IMAGE_CONVERT_TOOL_DESCRIPTION =
  "Convert an image to a different format (jpeg, png, webp, avif, tiff). Returns the output file path and new image metadata.";

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

// ── QR Code ──────────────────────────────────────────────────────────

export const IMAGE_QRCODE_TOOL_DESCRIPTION = "Generate a PNG QR code image from text.";

export const qrCodeRequestSchema = z.object({
  text: z.string().min(1).describe("Text to encode in the QR code."),
  output: z
    .string()
    .optional()
    .describe("Output PNG path. If omitted, saves as 'qrcode.png' in the project root."),
  size: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .describe("Size of each QR module in pixels (1-50). Default: 5."),
  margin: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(4)
    .describe("White-space margin around the QR code in modules (0-100). Default: 4."),
  errorCorrection: z
    .enum(["L", "M", "Q", "H"])
    .default("M")
    .describe("Error correction level. Default: M."),
});

export const qrCodeRespondSchema = z.object({
  result: z.object({
    output: z.string(),
  }),
});

export type QrCodeRequest = z.infer<typeof qrCodeRequestSchema>;
export type QrCodeRespond = z.infer<typeof qrCodeRespondSchema>;

// ── Audio Transcribe ─────────────────────────────────────────────────

export const AUDIO_TRANSCRIBE_TOOL_DESCRIPTION =
  "Transcribe an audio file to text. Decodes with the system ffmpeg and recognizes with the speech-to-text provider configured in the app settings; if either is unavailable, the result explains what is missing and how to fix it — resolve it, then call this tool again with the same arguments. If ffmpeg lives outside PATH, pass its absolute path via ffmpegPath.";

export const audioTranscribeRequestSchema = z.object({
  path: z.string().describe("Absolute or project-relative path to the audio file to transcribe."),
  language: z
    .string()
    .optional()
    .describe(
      "BCP-47 language hint, e.g. 'zh-CN' or 'en-US'. If omitted, the language configured for the active speech-to-text provider is used.",
    ),
  ffmpegPath: z
    .string()
    .optional()
    .describe(
      "Absolute path to the ffmpeg executable, for when it is not on PATH (e.g. a custom install location). When provided it is used as-is: an unusable path is reported as an error instead of falling back to auto-detection. Omit it to auto-detect (FFMPEG_PATH env var, then PATH, then common install directories).",
    ),
  timeoutSeconds: z
    .number()
    .int()
    .min(10)
    .max(3600)
    .default(600)
    .describe("Maximum time to wait for the transcription, in seconds (10-3600). Default: 600."),
});

export const audioTranscribeRespondSchema = z.object({
  result: z.object({
    text: z.string(),
    durationSeconds: z.number(),
    segments: z.number(),
  }),
});

export type AudioTranscribeRequest = z.infer<typeof audioTranscribeRequestSchema>;
export type AudioTranscribeRespond = z.infer<typeof audioTranscribeRespondSchema>;

// ── Text to Speech ───────────────────────────────────────────────────

export const TEXT_TO_SPEECH_TOOL_DESCRIPTION =
  "Synthesize text into an audio file, using the text-to-speech provider configured in the app settings, and return the output file path. Defaults to WAV (needs no extra tools); format 'mp3' additionally requires the system ffmpeg. If the provider or ffmpeg is unavailable, the result explains what is missing and how to fix it — resolve it, then call this tool again. Pair with share_to_user to let the user listen to the audio.";

export const textToSpeechRequestSchema = z.object({
  text: z.string().min(1).describe("The text to synthesize into speech."),
  output: z
    .string()
    .optional()
    .describe(
      "Output audio path; a relative path resolves against the project root. If omitted, saves as 'speech.wav' (or 'speech.mp3' when format is 'mp3') in the project root.",
    ),
  format: z
    .enum(["wav", "mp3"])
    .default("wav")
    .describe(
      "Output audio format. 'wav' needs no extra tools; 'mp3' additionally requires the system ffmpeg. Default: wav.",
    ),
});

export const textToSpeechRespondSchema = z.object({
  result: z.object({
    output: z.string(),
    format: z.enum(["wav", "mp3"]),
    sampleRate: z.number(),
    channels: z.number(),
    durationSeconds: z.number(),
    bytes: z.number(),
  }),
});

export type TextToSpeechRequest = z.infer<typeof textToSpeechRequestSchema>;
export type TextToSpeechRespond = z.infer<typeof textToSpeechRespondSchema>;
