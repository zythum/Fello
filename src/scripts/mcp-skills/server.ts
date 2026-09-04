import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  skillCatalogSchema,
  skillDetailRequestSchema,
  skillDetailSchema,
} from "../../shared/zod/mcp-skills-schema";
import type { z } from "zod";
import * as fs from "fs";
import * as http from "http";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const socketPath = getArg("socket-path");
const projectDir = getArg("project-dir");
const catalogFile = getArg("catalog");

if (!socketPath) {
  console.error("[mcp-skills] Missing required argument: --socket-path");
  process.exit(1);
}

if (!projectDir) {
  console.error("[mcp-skills] Missing required argument: --project-dir");
  process.exit(1);
}

let initialCatalog: z.infer<typeof skillCatalogSchema> = [];
if (catalogFile) {
  try {
    initialCatalog = skillCatalogSchema.parse(JSON.parse(fs.readFileSync(catalogFile, "utf8")));
  } finally {
    try {
      fs.unlinkSync(catalogFile);
    } catch {}
  }
}

// ── MCP Server Setup ────────────────────────────────────────────────

const server = new McpServer({
  name: "Agent Skills",
  version: "1.0.0",
  description: "MCP server that exposes Agent Skills via tools.",
});

server.registerTool(
  "list_skills",
  {
    title: "List Skills",
    description:
      "Get available **Agent Skills** Catalog with their id, name and description. " +
      "If the user message contains a skill mention in the form `@skill:xxxxx`, call this tool to find the matching skill before proceeding, then use the returned skill id with `activate_skill`." +
      (() => {
        if (initialCatalog.length <= 0) {
          return "";
        }
        let result = "\nInitial Catalog:\n```json";
        result += JSON.stringify(initialCatalog, null, "  ");
        result += "\n```";
        return result;
      })(),
  },
  async () => {
    try {
      const catalog = await postToSocket("/skills/catalog", {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(catalog, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to list skills: ${err.message}` }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "activate_skill",
  {
    title: "Activate Skills",
    description:
      "Activate a **Agent Skill** by id, loading its full instructions and listing supporting files.",
    inputSchema: skillDetailRequestSchema,
  },
  async ({ id }) => {
    try {
      const detail = skillDetailSchema.parse(await postToSocket("/skills/detail", { id }));
      return {
        content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: `Failed to activate skill '${id}': ${err.message}` },
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
