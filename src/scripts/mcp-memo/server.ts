import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  memoAddRequestSchema,
  memoAddRespondSchema,
  memoDeleteRequestSchema,
  memoDeleteRespondSchema,
  memoGetCurrentRequestSchema,
  memoGetCurrentRespondSchema,
  memoSetWeightRequestSchema,
  memoSetWeightRespondSchema,
  memoTouchRequestSchema,
  memoTouchRespondSchema,
} from "../../shared/zod/mcp-memo-schema";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const socketPath = getArg("socket-path");
const writable = process.argv.includes("--writable");

if (!socketPath) {
  console.error("[mcp-memo] Missing required argument: --socket-path");
  process.exit(1);
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Memo",
  version: "1.0.0",
  description: writable
    ? "Provides transactional tools for organizing project memory entries."
    : "Provides tools to retrieve and mark project memory entries as used.",
});

server.registerTool(
  "memo_get_current",
  {
    description:
      "Read the current project memory entries and their backend-generated, read-only IDs. Call this exactly once before any other memo tool.",
    inputSchema: memoGetCurrentRequestSchema,
  },
  async () => {
    try {
      const result = memoGetCurrentRespondSchema.parse(await postToSocket("/memo/read", {}));
      return {
        content: [
          {
            type: "text" as const,
            text: result.content || '{"entries":[]}',
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          { type: "text" as const, text: `Error reading memory: ${getErrorMessage(error)}` },
        ],
        isError: true,
      };
    }
  },
);

if (writable) {
  server.registerTool(
    "memo_add",
    {
      description: `Add one new immutable memory entry to the current transaction draft. The backend generates its ID and date.
Use weight 3 only for an explicit durable instruction or prohibition governing how the agent must act. If the same text already exists, the tool reports content_exists and leaves the draft unchanged.`,
      inputSchema: memoAddRequestSchema,
    },
    async (input) => {
      try {
        const result = memoAddRespondSchema.parse(await postToSocket("/memo/add", input));
        return {
          content: [
            {
              type: "text" as const,
              text: result.ok
                ? `Added memory entry ${result.id}.`
                : `Content already exists as memory entry ${result.id}. Decide whether no further action is needed or whether the existing entry must first be deleted and replaced.`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            { type: "text" as const, text: `Error adding memory: ${getErrorMessage(error)}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "memo_delete",
    {
      description:
        "Delete one entry from the current transaction draft by its read-only ID. Use delete plus add when immutable text or tags must be replaced.",
      inputSchema: memoDeleteRequestSchema,
    },
    async (input) => {
      try {
        const result = memoDeleteRespondSchema.parse(await postToSocket("/memo/delete", input));
        return {
          content: [
            {
              type: "text" as const,
              text: result.ok
                ? `Deleted memory entry ${result.id}.`
                : `Memory entry ${result.id} was not found; the draft was unchanged.`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            { type: "text" as const, text: `Error deleting memory: ${getErrorMessage(error)}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "memo_set_weight",
    {
      description: `Set one entry's weight in the current transaction draft. This always refreshes its date.
Use weight 3 only for an explicit durable instruction or prohibition governing how the agent must act; repetition, correction, urgency, or technical necessity alone never justify weight 3.`,
      inputSchema: memoSetWeightRequestSchema,
    },
    async (input) => {
      try {
        const result = memoSetWeightRespondSchema.parse(
          await postToSocket("/memo/set-weight", input),
        );
        return {
          content: [
            {
              type: "text" as const,
              text: result.ok
                ? `Updated memory entry ${result.id} weight.`
                : `Memory entry ${result.id} was not found; the draft was unchanged.`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error setting memory weight: ${getErrorMessage(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
} else {
  server.registerTool(
    "memo_touch",
    {
      description:
        "Mark only the entries represented in the final retrieval response as used by refreshing their date. Pass their read-only IDs, not array indices.",
      inputSchema: memoTouchRequestSchema,
    },
    async (input) => {
      try {
        const result = memoTouchRespondSchema.parse(
          await postToSocket("/memo/touch", { ids: input.ids }),
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Touched ${result.touched} entries.`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error touching entries: ${getErrorMessage(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

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
