import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  shareToUserRequestSchema,
  shareToUserRespondSchema,
} from "../../shared/zod/mcp-share-to-user-schema";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const socketPath = getArg("socket-path");
const projectDir = getArg("project-dir");

if (!socketPath) {
  console.error("[mcp-share-to-user] Missing required argument: --socket-path");
  process.exit(1);
}

if (!projectDir) {
  console.error("[mcp-share-to-user] Missing required argument: --project-dir");
  process.exit(1);
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Share to User",
  version: "1.0.0",
  description:
    "Share files (images, documents, etc.) directly to the user's chat area. Supports image preview and file cards.",
});

server.registerTool(
  "share_to_user",
  {
    description: `Share a file to the user's chat area for them to see. Supports images (with preview), PDFs, documents, and any file type (shown as a file card).
Provide the file as a file:// URI, https:// URL, base64-encoded data, or a project-relative path (zero-copy).`,
    inputSchema: shareToUserRequestSchema,
  },
  async (input) => {
    try {
      const result = shareToUserRespondSchema.parse(
        await postToSocket("/share-to-user/share", input),
      );

      const respond: Record<string, unknown> = { name: result.name };
      if (result.sharePath) respond.sharePath = result.sharePath;
      if (result.projectPath) respond.projectPath = result.projectPath;
      if (result.mimeType) respond.mimeType = result.mimeType;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, fello: { "share-to-user": respond } }, null, 2),
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
