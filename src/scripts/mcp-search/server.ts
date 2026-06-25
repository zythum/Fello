import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  searchRequestSchema,
  searchRespondSchema,
  rgRequestSchema,
  rgRespondSchema,
  fileOutlineRequestSchema,
  fileOutlineRespondSchema,
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
  description:
    "Search file contents and inspect file structure. Provides search (common patterns), rg (raw ripgrep args), and file_outline (AST-based file structure preview).",
});

server.registerTool(
  "search",
  {
    description: `Search file contents for common patterns using ripgrep.
Fast, respects .gitignore, skips hidden/binary files by default.
For advanced rg flags not covered here (multiline, PCRE2, --sort, --json, --stats, etc.), use the rg tool instead.

Common examples:
  search("TODO", ".")
  search("function", "src/", { type: "ts" })
  search("console.log", "src/", { ignoreCase: true, context: 2 })
  search("import", ".", { glob: "*.tsx", maxResults: 20 })
  search("useEffect", "src/", { listFiles: true })

The path parameter accepts:
- Relative path (relative to project root): "src/", "./lib"
- Absolute path (POSIX or Windows): "/Users/me/project/src", "C:\\project\\src"
- file:// URI: "file:///Users/me/project/src"`,
    inputSchema: searchRequestSchema,
  },
  async (input) => {
    try {
      const result = searchRespondSchema.parse(await postToSocket("/search/search", input));
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
  "rg",
  {
    description: `Run raw ripgrep (rg) with full CLI argument support.
Use this when you need rg flags not covered by the search tool (multiline, PCRE2, --sort, --json, --stats, --no-ignore, --type-add, etc.).

Full reference: https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md

Common examples:
  rg(["--multiline", "class\\n.*\\n\\{", "src/"])
  rg(["-P", "pattern", "src/"])
  rg(["--json", "pattern", "src/"])
  rg(["--stats", "-l", "pattern", "src/"])
  rg(["--type-add", "web:*.{html,css,js}", "-t", "web", "pattern"])
  rg(["-u", "pattern", "src/"])

Paths in args are automatically normalized:
- Relative paths resolve against the project root
- Absolute paths and file:// URIs are used as-is`,
    inputSchema: rgRequestSchema,
  },
  async (input) => {
    try {
      const result = rgRespondSchema.parse(await postToSocket("/search/rg", input));
      const content: string[] = [];
      if (result.output) content.push(result.output);
      if (result.stderr) content.push(`[stderr]\n${result.stderr}`);
      return {
        content: [
          {
            type: "text",
            text: content.join("\n\n") || `(exit code: ${result.code})`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: `rg failed: ${err.message || String(err)}`,
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
    description: `Get a structural outline of a file WITHOUT reading its full content.
Use this to understand a file's structure before reading it.
Uses tree-sitter WASM parsing to extract function/class/interface/type/property signatures with line ranges and JSDoc comments.
Returns tree-structured metadata only - no code body is included.
Use this first before ReadFile to understand a file's structure.

Supports: TypeScript (.ts), JavaScript/JSX (.js/.jsx/.mjs/.cjs), TSX (.tsx), Python (.py), Go (.go), C (.c/.h), C++ (.cpp/.cc/.cxx/.hpp/.hxx/.hh), Swift (.swift), Kotlin (.kt/.kts), Markdown (.md/.mdx/.markdown).

The path parameter accepts:
- Relative path (relative to project root): "src/app.ts", "./lib/utils.ts"
- Absolute path (POSIX or Windows): "/Users/me/project/src/app.ts", "C:\\project\\src\\app.ts"
- file:// URI: "file:///Users/me/project/src/app.ts"`,
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
