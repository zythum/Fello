import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { askUserRequestSchema, askUserRespondSchema } from "../../shared/zod/ask-user-mcp-schema";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const socketPath = getArg("socket-path");

if (!socketPath) {
  console.error("[mcp-ask-user] Missing required argument: --socket-path");
  process.exit(1);
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Ask User",
  version: "1.0.0",
  description:
    "Provides ask_user tool that lets the agent proactively ask the user for input when unsure about intent, facing choices, or needing confirmation.",
});

server.registerTool(
  "ask_user",
  {
    description: `Ask the user a question and wait for their response. Don't be shy — proactively ask the user when:

- You are unsure about the user's intent or goal
- There are multiple reasonable approaches and you need guidance
- You need permission or confirmation before taking an action
- You encounter ambiguity and need clarification
- The user seems to have trouble making a decision — help them by presenting clear options

This is your primary channel to communicate back to the user when you need input. Use it whenever you're not 100% sure what to do next. It's better to ask than to guess.`,
    inputSchema: askUserRequestSchema,
  },
  async (input) => {
    try {
      const result = askUserRespondSchema.parse(await postToSocket("/ask-user", input));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                value: result.value,
                reason: result.reason,
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
            text: JSON.stringify(
              {
                error: err.message || String(err),
                value: null,
                reason: "error",
              },
              null,
              2,
            ),
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
        const raw = Buffer.concat(chunks).toString("utf-8");
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
