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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadCriticalMemories(filePath: string | undefined): string[] {
  if (!filePath) return [];

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch (error: unknown) {
    console.error(`[mcp-memory] Failed to load critical memories: ${getErrorMessage(error)}`);
    return [];
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

const socketPath = getArg("socket-path");
const criticalMemories = loadCriticalMemories(getArg("critical-memory"));

if (!socketPath) {
  console.error("[mcp-memory] Missing required argument: --socket-path");
  process.exit(1);
}

const criticalMemoryDescription =
  criticalMemories.length === 0
    ? ""
    : `

Automatically loaded critical project memories — always follow these:
${criticalMemories.map((memory) => `- ${memory.replaceAll("\n", "\n  ")}`).join("\n")}

These are only the highest-priority project constraints, not the complete project memory. Do not treat the absence of a detail here as evidence that no relevant memory exists. This list does not replace task-specific retrieval.`;

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Memory",
  version: "1.0.0",
  description: "Provides memory_query and memory_store tools for persistent project-level memory.",
});

server.registerTool(
  "memory_query",
  {
    description: `Query the project's persistent memory.${criticalMemoryDescription}

For every specific task, question, recommendation, or domain discussion that may depend on memory, provide a focused query. Include all relevant dimensions in that query, such as applicable conventions, preferences, decisions, corrections, architecture, or commands.

Never omit query merely to discover whether relevant memories exist. Omit it only when a broad project-memory briefing is genuinely needed, such as when the user asks what is remembered.

A focused query returns relevant details. An omitted query generates a current summary from the stored entries. In either mode, memories included in the response are marked as used.`,
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
    } catch (error: unknown) {
      return {
        content: [
          { type: "text" as const, text: `Error querying memory: ${getErrorMessage(error)}` },
        ],
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

Each fact should be a concise, self-contained statement. Include a reason when the context helps determine importance (e.g. if the user strongly emphasized it or corrected the agent).`,
    inputSchema: memoryStoreRequestSchema,
  },
  async (input) => {
    try {
      const result = memoryStoreRespondSchema.parse(await postToSocket("/memory/store", input));
      return {
        content: [
          {
            type: "text" as const,
            text: result.message || `Stored ${result.stored} fact(s) to project memory.`,
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          { type: "text" as const, text: `Error storing memory: ${getErrorMessage(error)}` },
        ],
        isError: true,
      };
    }
  },
);

// ── HTTP Client over Unix Socket ────────────────────────────────────

function postToSocket(path: string, body: unknown): Promise<unknown> {
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
          const parsed: unknown = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const message =
              typeof parsed === "object" && parsed && "error" in parsed
                ? String(parsed.error)
                : `HTTP ${res.statusCode}: ${raw}`;
            reject(new Error(message));
          }
        } catch {
          reject(new Error(`Invalid response (${res.statusCode}): ${raw}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Socket request failed: ${error.message}`));
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
