import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  memoryQueryRequestSchema,
  memoryQueryRespondSchema,
  memoryStoreRequestSchema,
  memoryStoreRespondSchema,
} from "../../shared/zod/mcp-memory-schema";
import * as fs from "fs";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const socketPath = getArg("socket-path");
const projectDir = getArg("project-dir");
const memorySummaryFile = getArg("memory-summary");

if (!socketPath) {
  console.error("[mcp-memory] Missing required argument: --socket-path");
  process.exit(1);
}

if (!projectDir) {
  console.error("[mcp-memory] Missing required argument: --project-dir");
  process.exit(1);
}

// Load initial memory summary (high-weight items) and clean up temp file
let initialMemorySummary = "";
if (memorySummaryFile) {
  try {
    initialMemorySummary = fs.readFileSync(memorySummaryFile, "utf8").trim();
  } finally {
    try {
      fs.unlinkSync(memorySummaryFile);
    } catch {}
  }
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Memory",
  version: "1.0.0",
  description: "Provides memory_query and memory_store tools for persistent project-level memory.",
});

server.registerTool(
  "memory_query",
  {
    description:
      `Query the project's persistent memory. Performs semantic retrieval to find memories relevant to your question.

Use this to recall project conventions, user preferences, past decisions, or corrections.
Provide a descriptive query about what you need (e.g. "tech stack and build tools", "user's coding style preferences", "things to avoid").` +
      (() => {
        if (!initialMemorySummary) return "";
        return `\n\nKey memories (high priority — always consider these):\n${initialMemorySummary}`;
      })(),
    inputSchema: memoryQueryRequestSchema,
  },
  async (input) => {
    try {
      const result = memoryQueryRespondSchema.parse(await postToSocket("/memory/query", input));
      return {
        content: [
          {
            type: "text" as const,
            text: result.content || "(no project memories stored yet)",
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error querying memory: ${err.message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "memory_store",
  {
    description: `Store facts into persistent project memory for future sessions.

Proactively store facts worth remembering for future sessions. Common triggers:
- User states a preference, makes a choice, or corrects your behavior (even subtly)
- You discover a project convention, tech stack detail, or architectural decision
- User emphasizes something with "always", "never", "remember", "一定", "不要"
- User explicitly asks you to remember something

Also store when:
- User explains why they do something a certain way
- User mentions a tool, framework, or library choice
- You make a decision during the conversation that affects future work
- User tells you to skip or avoid something

When in doubt about whether to store — store it. Forgetting costs more than duplicating.

Each fact should be a concise, self-contained statement. Include a reason when the context helps determine importance (e.g. if the user strongly emphasized something, or corrected you).`,
    inputSchema: memoryStoreRequestSchema,
  },
  async (input) => {
    try {
      const result = memoryStoreRespondSchema.parse(await postToSocket("/memory/store", input));
      return {
        content: [
          {
            type: "text" as const,
            text: result.summary || `Stored ${result.stored} fact(s) to project memory.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error storing memory: ${err.message}` }],
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
