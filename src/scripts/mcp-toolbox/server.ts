import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  TOOLBOX_SERVER_DESCRIPTION,
  BASE64_ENCODE_TOOL_DESCRIPTION,
  BASE64_DECODE_TOOL_DESCRIPTION,
  URL_ENCODE_TOOL_DESCRIPTION,
  URL_DECODE_TOOL_DESCRIPTION,
  HASH_TOOL_DESCRIPTION,
  TIME_TOOL_DESCRIPTION,
  UUID_TOOL_DESCRIPTION,
  SHORT_ID_TOOL_DESCRIPTION,
  RANDOM_TOOL_DESCRIPTION,
  RAND_INT_TOOL_DESCRIPTION,
  CHOICE_TOOL_DESCRIPTION,
  SHUFFLE_TOOL_DESCRIPTION,
  IMAGE_METADATA_TOOL_DESCRIPTION,
  IMAGE_THUMBNAIL_TOOL_DESCRIPTION,
  IMAGE_RESIZE_TOOL_DESCRIPTION,
  IMAGE_CONVERT_TOOL_DESCRIPTION,
  IMAGE_QRCODE_TOOL_DESCRIPTION,
  AUDIO_TRANSCRIBE_TOOL_DESCRIPTION,
  TEXT_TO_SPEECH_TOOL_DESCRIPTION,
  base64EncodeRequestSchema,
  base64DecodeRequestSchema,
  urlEncodeRequestSchema,
  urlDecodeRequestSchema,
  hashRequestSchema,
  timeRequestSchema,
  uuidRequestSchema,
  shortIdRequestSchema,
  randomRequestSchema,
  randIntRequestSchema,
  choiceRequestSchema,
  shuffleRequestSchema,
  imageMetadataRequestSchema,
  imageThumbnailRequestSchema,
  imageResizeRequestSchema,
  imageConvertRequestSchema,
  qrCodeRequestSchema,
  audioTranscribeRequestSchema,
  textToSpeechRequestSchema,
  base64EncodeRespondSchema,
  base64DecodeRespondSchema,
  urlEncodeRespondSchema,
  urlDecodeRespondSchema,
  hashRespondSchema,
  timeRespondSchema,
  uuidRespondSchema,
  shortIdRespondSchema,
  randomRespondSchema,
  randIntRespondSchema,
  choiceRespondSchema,
  shuffleRespondSchema,
  imageMetadataRespondSchema,
  imageThumbnailRespondSchema,
  imageResizeRespondSchema,
  imageConvertRespondSchema,
  qrCodeRespondSchema,
  audioTranscribeRespondSchema,
  textToSpeechRespondSchema,
} from "../../shared/zod/mcp-toolbox-schema";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const socketPath = getArg("socket-path");
const projectDir = getArg("project-dir");

if (!socketPath) {
  console.error("[mcp-toolbox] Missing required argument: --socket-path");
  process.exit(1);
}

if (!projectDir) {
  console.error("[mcp-toolbox] Missing required argument: --project-dir");
  process.exit(1);
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Toolbox",
  version: "1.0.0",
  description: TOOLBOX_SERVER_DESCRIPTION,
});

// ── Base64 Encode ───────────────────────────────────────────────────

server.registerTool(
  "base64_encode",
  {
    description: BASE64_ENCODE_TOOL_DESCRIPTION,
    inputSchema: base64EncodeRequestSchema,
  },
  async (input) => {
    try {
      const res = base64EncodeRespondSchema.parse(
        await postToSocket("/toolbox/base64-encode", { text: input.text }),
      );
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Base64 Decode ───────────────────────────────────────────────────

server.registerTool(
  "base64_decode",
  {
    description: BASE64_DECODE_TOOL_DESCRIPTION,
    inputSchema: base64DecodeRequestSchema,
  },
  async (input) => {
    try {
      const res = base64DecodeRespondSchema.parse(
        await postToSocket("/toolbox/base64-decode", { base64: input.base64 }),
      );
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── URL Encode ──────────────────────────────────────────────────────

server.registerTool(
  "url_encode",
  {
    description: URL_ENCODE_TOOL_DESCRIPTION,
    inputSchema: urlEncodeRequestSchema,
  },
  async (input) => {
    try {
      const res = urlEncodeRespondSchema.parse(
        await postToSocket("/toolbox/url-encode", { text: input.text }),
      );
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── URL Decode ──────────────────────────────────────────────────────

server.registerTool(
  "url_decode",
  {
    description: URL_DECODE_TOOL_DESCRIPTION,
    inputSchema: urlDecodeRequestSchema,
  },
  async (input) => {
    try {
      const res = urlDecodeRespondSchema.parse(
        await postToSocket("/toolbox/url-decode", { text: input.text }),
      );
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Hash ────────────────────────────────────────────────────────────

server.registerTool(
  "hash",
  {
    description: HASH_TOOL_DESCRIPTION,
    inputSchema: hashRequestSchema,
  },
  async (input) => {
    try {
      const res = hashRespondSchema.parse(
        await postToSocket("/toolbox/hash", {
          text: input.text,
          algorithm: input.algorithm,
        }),
      );
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Time ────────────────────────────────────────────────────────────

server.registerTool(
  "time",
  {
    description: TIME_TOOL_DESCRIPTION,
    inputSchema: timeRequestSchema,
  },
  async (input) => {
    try {
      const res = timeRespondSchema.parse(
        await postToSocket("/toolbox/time", { format: input.format }),
      );
      return { content: [{ type: "text", text: String(res.result) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── UUID ────────────────────────────────────────────────────────────

server.registerTool(
  "uuid",
  {
    description: UUID_TOOL_DESCRIPTION,
    inputSchema: uuidRequestSchema,
  },
  async () => {
    try {
      const res = uuidRespondSchema.parse(await postToSocket("/toolbox/uuid", {}));
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Short ID ────────────────────────────────────────────────────────

server.registerTool(
  "short_id",
  {
    description: SHORT_ID_TOOL_DESCRIPTION,
    inputSchema: shortIdRequestSchema,
  },
  async (input) => {
    try {
      const res = shortIdRespondSchema.parse(
        await postToSocket("/toolbox/short-id", { length: input.length }),
      );
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Random ──────────────────────────────────────────────────────────

server.registerTool(
  "random",
  {
    description: RANDOM_TOOL_DESCRIPTION,
    inputSchema: randomRequestSchema,
  },
  async (input) => {
    try {
      const res = randomRespondSchema.parse(
        await postToSocket("/toolbox/random", {
          length: input.length,
          charset: input.charset,
        }),
      );
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── RandInt ─────────────────────────────────────────────────────────

server.registerTool(
  "rand_int",
  {
    description: RAND_INT_TOOL_DESCRIPTION,
    inputSchema: randIntRequestSchema,
  },
  async (input) => {
    try {
      const res = randIntRespondSchema.parse(
        await postToSocket("/toolbox/rand-int", { min: input.min, max: input.max }),
      );
      return { content: [{ type: "text", text: String(res.result) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Choice ──────────────────────────────────────────────────────────

server.registerTool(
  "choice",
  {
    description: CHOICE_TOOL_DESCRIPTION,
    inputSchema: choiceRequestSchema,
  },
  async (input) => {
    try {
      const res = choiceRespondSchema.parse(
        await postToSocket("/toolbox/choice", { items: input.items }),
      );
      return { content: [{ type: "text", text: res.result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Shuffle ─────────────────────────────────────────────────────────

server.registerTool(
  "shuffle",
  {
    description: SHUFFLE_TOOL_DESCRIPTION,
    inputSchema: shuffleRequestSchema,
  },
  async (input) => {
    try {
      const res = shuffleRespondSchema.parse(
        await postToSocket("/toolbox/shuffle", { items: input.items }),
      );
      return { content: [{ type: "text", text: JSON.stringify(res.result) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Image Metadata ──────────────────────────────────────────────────

server.registerTool(
  "image_metadata",
  {
    description: IMAGE_METADATA_TOOL_DESCRIPTION,
    inputSchema: imageMetadataRequestSchema,
  },
  async (input) => {
    try {
      const res = imageMetadataRespondSchema.parse(
        await postToSocket("/toolbox/image-metadata", { path: input.path }),
      );
      return { content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Image Thumbnail ─────────────────────────────────────────────────

server.registerTool(
  "image_thumbnail",
  {
    description: IMAGE_THUMBNAIL_TOOL_DESCRIPTION,
    inputSchema: imageThumbnailRequestSchema,
  },
  async (input) => {
    try {
      const res = imageThumbnailRespondSchema.parse(
        await postToSocket("/toolbox/image-thumbnail", {
          path: input.path,
          width: input.width,
          output: input.output,
        }),
      );
      return { content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Image Resize ────────────────────────────────────────────────────

server.registerTool(
  "image_resize",
  {
    description: IMAGE_RESIZE_TOOL_DESCRIPTION,
    inputSchema: imageResizeRequestSchema,
  },
  async (input) => {
    try {
      const res = imageResizeRespondSchema.parse(
        await postToSocket("/toolbox/image-resize", {
          path: input.path,
          width: input.width,
          height: input.height,
          fit: input.fit,
          output: input.output,
        }),
      );
      return { content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Image Convert ───────────────────────────────────────────────────

server.registerTool(
  "image_convert",
  {
    description: IMAGE_CONVERT_TOOL_DESCRIPTION,
    inputSchema: imageConvertRequestSchema,
  },
  async (input) => {
    try {
      const res = imageConvertRespondSchema.parse(
        await postToSocket("/toolbox/image-convert", {
          path: input.path,
          format: input.format,
          quality: input.quality,
          output: input.output,
        }),
      );
      return { content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── QR Code ─────────────────────────────────────────────────────────

server.registerTool(
  "image_qrcode",
  {
    description: IMAGE_QRCODE_TOOL_DESCRIPTION,
    inputSchema: qrCodeRequestSchema,
  },
  async (input) => {
    try {
      const res = qrCodeRespondSchema.parse(
        await postToSocket("/toolbox/image-qrcode", {
          text: input.text,
          output: input.output,
          size: input.size,
          margin: input.margin,
          errorCorrection: input.errorCorrection,
        }),
      );
      return { content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Audio Transcribe ────────────────────────────────────────────────
// 工具始终注册：未配置语音识别 / 未安装 ffmpeg 时，由主进程返回带指引的错误。

server.registerTool(
  "audio_transcribe",
  {
    description: AUDIO_TRANSCRIBE_TOOL_DESCRIPTION,
    inputSchema: audioTranscribeRequestSchema,
  },
  async (input) => {
    try {
      const res = audioTranscribeRespondSchema.parse(
        await postToSocket("/toolbox/audio-transcribe", {
          path: input.path,
          language: input.language,
          ffmpegPath: input.ffmpegPath,
          timeoutSeconds: input.timeoutSeconds,
        }),
      );
      return { content: [{ type: "text", text: res.result.text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Text to Speech ──────────────────────────────────────────────────
// 工具始终注册：未配置语音合成 / mp3 需要 ffmpeg 而未安装时，由主进程返回带指引的错误。

server.registerTool(
  "text_to_speech",
  {
    description: TEXT_TO_SPEECH_TOOL_DESCRIPTION,
    inputSchema: textToSpeechRequestSchema,
  },
  async (input) => {
    try {
      const res = textToSpeechRespondSchema.parse(
        await postToSocket("/toolbox/text-to-speech", {
          text: input.text,
          output: input.output,
          format: input.format,
        }),
      );
      return { content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Image Read (removed — use the built-in ImageRead / ImageAnalysis tools) ──

// ── HTTP Client over Unix Socket ────────────────────────────────────

function postToSocket(path: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);

    const options: http.RequestOptions = {
      socketPath,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}: ${raw}`));
          }
        } catch {
          reject(new Error(`Invalid response (${res.statusCode}): ${raw}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(`Socket request failed: ${err.message}`));
    });

    req.write(data);
    req.end();
  });
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
