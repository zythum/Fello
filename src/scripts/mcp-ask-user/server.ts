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
    description: `Ask the user a question and wait for their response. Use this tool whenever you need input — it's your only channel to communicate directly with the user.

## When to ask

Ask proactively in these situations:

- 🔴 Ambiguous intent — Unsure what the user wants
- 🟡 Multiple options — Several reasonable approaches, need guidance
- 🟢 Permission needed — Confirmation before taking action
- 🔵 Unclear context — Encounter ambiguity and need clarification
- 🟣 Decision support — User seems uncertain; present clear options to help them choose

## Option design

Options are not required, but you SHOULD provide them. Users prefer choosing from a list over typing free-form answers — it's faster and leads to better decisions.

- Provide 2–5 concrete, actionable options
- Each option should be self-explanatory and distinct from others
- Use the "priority" field to highlight your recommendation: set one option as "high" (your best pick) and the rest as "medium" or "low"
- If free-form input truly makes more sense (open-ended brainstorming, naming things, etc.), pass an empty options array to let the user type freely

## Best practices

- Frame the question clearly in the "title" — summarize the decision point
- In "description", give just enough context for the user to understand the trade-off; don't dump raw logs or code
- Ask one decision at a time; don't bundle unrelated questions into one call`,
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
