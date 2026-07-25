import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
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
  screenshotRequestSchema,
  listDisplaysRequestSchema,
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
  screenshotRespondSchema,
  listDisplaysRespondSchema,
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
  description: "Built-in utility tools: base64, URL encode/decode, hash, time, UUID, random, etc.",
});

// ── Base64 Encode ───────────────────────────────────────────────────

server.registerTool(
  "base64_encode",
  {
    description: "Encode a text string into Base64 format. Supports UTF-8 text.",
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
    description: "Decode a Base64-encoded string back into UTF-8 text.",
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
    description: "URL-encode a text string (percent-encoding).",
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
    description: "Decode a URL-encoded (percent-encoded) string back into text.",
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
    description: "Compute a hash (MD5, SHA1, or SHA256) of a text string. Returns hex digest.",
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
    description:
      "Get the current time. Returns either an ISO 8601 string or a Unix timestamp in seconds.",
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
    description: "Generate a random UUID v4.",
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
    description: "Generate a short random alphanumeric ID.",
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
    description: "Generate a random string with specified length and character set.",
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
    description: "Generate a random integer between min and max (inclusive).",
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
    description: "Pick a random item from an array.",
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
    description: "Shuffle an array randomly (Fisher-Yates).",
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
    description:
      "Read image metadata (width, height, format, color space, channels, etc.) from a file.",
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
    description:
      "Generate a thumbnail from an image. Returns the output file path and new image metadata.",
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
    description:
      "Resize an image to specified dimensions. Returns the output file path and new image metadata.",
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
    description:
      "Convert an image to a different format (jpeg, png, webp, avif, tiff). Returns the output file path and new image metadata.",
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

// ── Screenshot ──────────────────────────────────────────────────────

function registerScreenshotTool(name: string, description: string) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: screenshotRequestSchema,
    },
    async (input) => {
      try {
        const res = screenshotRespondSchema.parse(
          await postToSocket("/toolbox/screenshot", {
            output: input.output,
            format: input.format,
            screen: input.screen,
            width: input.width,
          }),
        );
        return { content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    },
  );
}

registerScreenshotTool(
  "screenshot",
  "Capture a screenshot of the display. Use 'screen' parameter (0-based index) to select a specific display on multi-monitor setups; omit to capture all displays combined. Returns the output file path and image metadata.",
);

// ── List Displays ────────────────────────────────────────────────────

server.registerTool(
  "list_displays",
  {
    description:
      "List available displays/screens. Returns each display's 0-based index (usable as the 'screen' parameter in screenshot tool), name, and whether it's the primary display.",
    inputSchema: listDisplaysRequestSchema,
  },
  async () => {
    try {
      const res = listDisplaysRespondSchema.parse(await postToSocket("/toolbox/list-displays", {}));
      return { content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Image Read (removed — use built-in image_analysis tool instead) ──

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
