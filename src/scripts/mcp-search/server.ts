import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  SEARCH_SERVER_DESCRIPTION,
  GREP_TOOL_DESCRIPTION,
  GLOB_TOOL_DESCRIPTION,
  FILE_OUTLINE_TOOL_DESCRIPTION,
  grepRequestSchema,
  grepRespondSchema,
  fileOutlineRequestSchema,
  fileOutlineRespondSchema,
  globRequestSchema,
  globRespondSchema,
} from "../../shared/zod/mcp-search-schema";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const socketPath = getArg("socket-path");
const projectDir = getArg("project-dir");

if (!socketPath) {
  console.error("[mcp-search] Missing required argument: --socket-path");
  process.exit(1);
}

if (!projectDir) {
  console.error("[mcp-search] Missing required argument: --project-dir");
  process.exit(1);
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Search",
  version: "1.0.0",
  description: SEARCH_SERVER_DESCRIPTION,
});

server.registerTool(
  "grep",
  {
    description: GREP_TOOL_DESCRIPTION,
    inputSchema: grepRequestSchema,
  },
  async (input) => {
    try {
      const result = grepRespondSchema.parse(await postToSocket("/search/grep", input));
      return {
        content: [
          {
            type: "text",
            text: result.output || "(no matches)",
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: `Search failed: ${err.message || String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "glob",
  {
    description: GLOB_TOOL_DESCRIPTION,
    inputSchema: globRequestSchema,
  },
  async (input) => {
    try {
      const result = globRespondSchema.parse(await postToSocket("/search/glob", input));
      const header = result.truncated
        ? `Found ${result.totalFiles} matches (showing first ${result.filePaths.length}):\n`
        : "";
      return {
        content: [
          {
            type: "text",
            text: header + result.filePaths.join("\n") || "(no matches)",
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: `glob failed: ${err.message || String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "file_outline",
  {
    description: FILE_OUTLINE_TOOL_DESCRIPTION,
    inputSchema: fileOutlineRequestSchema,
  },
  async (input) => {
    try {
      const result = fileOutlineRespondSchema.parse(
        await postToSocket("/search/file_outline", input),
      );
      return {
        content: [
          {
            type: "text",
            text: result.outline,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: `file_outline failed: ${err.message || String(err)}`,
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
