import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { imageGenerationRequestSchema } from "../../shared/zod/mcp-image-generation-schema";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const socketPath = getArg("socket-path");
const projectDir = getArg("project-dir");

if (!socketPath) {
  console.error("[mcp-image-generation] Missing required argument: --socket-path");
  process.exit(1);
}

if (!projectDir) {
  console.error("[mcp-image-generation] Missing required argument: --project-dir");
  process.exit(1);
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Image Generation",
  version: "1.0.0",
  description: "Generate images from text prompts using configured image generation providers.",
});

server.registerTool(
  "image_generation",
  {
    description: `Generate images based on a text prompt. The generated images will be displayed to the user directly.
Use this tool when the user asks you to create, generate, or draw an image.
The images will be saved and shown to the user automatically.
You MUST specify a size. Common sizes: '1024x1024' (square), '1536x1024' (landscape), '1024x1536' (portrait), '1792x1024' (wide), '1024x1792' (tall).`,
    inputSchema: imageGenerationRequestSchema,
  },
  async (input) => {
    try {
      const result = await postToSocket("/image-generation/generate", input);

      const respond = result.respond;
      const filePaths: string[] = result.filePaths;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                fello: { "image-generation": respond },
                filePaths,
                model: respond.model,
                size: respond.size,
                imageCount: respond.images.length,
                message: `${respond.images.length} image(s) generated and shown to user.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: err.message || String(err) }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
);

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
