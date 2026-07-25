import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  memoGetCurrentRequestSchema,
  memoGetCurrentRespondSchema,
  memoSaveRequestSchema,
  memoSaveRespondSchema,
  memoTouchRequestSchema,
  memoTouchRespondSchema,
} from "../../shared/zod/mcp-memo-schema";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const socketPath = getArg("socket-path");

if (!socketPath) {
  console.error("[mcp-memo] Missing required argument: --socket-path");
  process.exit(1);
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Memo",
  version: "1.0.0",
  description: "Provides memo_get_current and memo_save tools for the memory organizer agent.",
});

server.registerTool(
  "memo_get_current",
  {
    description: `Read the current project memory file. Call this first to see what's already stored before making changes.`,
    inputSchema: memoGetCurrentRequestSchema,
  },
  async () => {
    try {
      const result = memoGetCurrentRespondSchema.parse(await postToSocket("/memo/read", {}));
      return {
        content: [
          {
            type: "text" as const,
            text: result.content || "(empty - no memories stored yet)",
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error reading memory: ${err.message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "memo_save",
  {
    description: `Save the complete organized memory content as a JSON string. This replaces the entire memory file.
The JSON must be an object with: { "version": 1, "entries": [...], "summary": "..." }
Each entry has fields: weight (number), text (string), date (string), tags (string[]).
The "summary" field is a concise Markdown overview of important entries, grouped by category. Include it only if there are notable entries worth summarizing.
Entries must be sorted by weight descending. You MUST include all entries you want to keep.`,
    inputSchema: memoSaveRequestSchema,
  },
  async (input) => {
    try {
      const result = memoSaveRespondSchema.parse(
        await postToSocket("/memo/save", { content: input.content }),
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Memory saved (${result.entries} entries).`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error saving memory: ${err.message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "memo_touch",
  {
    description: `Mark memory entries as "used" by updating their date to today. Call this after retrieving memories to indicate which entries were relevant to the query. This prevents active entries from being evicted by age-based cleanup.`,
    inputSchema: memoTouchRequestSchema,
  },
  async (input) => {
    try {
      const result = memoTouchRespondSchema.parse(
        await postToSocket("/memo/touch", { indices: input.indices }),
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Touched ${result.touched} entries.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error touching entries: ${err.message}` }],
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
