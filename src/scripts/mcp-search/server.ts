import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
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
  description:
    "Search file contents and inspect file structure. Provides grep (pattern search), glob (file finder), and file_outline (AST-based file structure preview).",
});

server.registerTool(
  "grep",
  {
    description: `Search file contents for common patterns using ripgrep.
Fast, respects .gitignore, skips hidden/binary files by default.
Pattern is treated as literal text by default. Set regex=true if you need regex.

The path parameter accepts:
- Relative path (relative to project root): "src/", "./lib"
- Absolute path (POSIX or Windows): "/Users/me/project/src", "C:\\project\\src"
- file:// URI: "file:///Users/me/project/src"`,
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
    description: `Find files and directories whose paths match a glob pattern. Respects .gitignore.

WHEN TO USE:
- Finding files by name pattern (e.g., "*.rs", "**/*.tsx")
- Discovering project structure
- Listing files in specific directories

HOW TO USE:
- Provide a glob pattern to match files
- Optionally specify a path to narrow the search directory
- Optionally specify a limit on results and max depth

PATTERNS:
- "*.rs" - All .rs files in current directory
- "**/*.rs" - All .rs files recursively
- "src/**/*.{ts,tsx}" - All TypeScript files under src/
- "**/test/**" - All files under any test/ directory
- "**/*.test.{js,ts}" - All test files
- "**/index.ts" - All index.ts files at any depth
- "src/*" - Only direct children of src/ (non-recursive)
- "**/*.{json,yaml,yml}" - All config-like files
`,
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
    description: `Get a structural outline of a file WITHOUT reading its full content.
Use this to understand a file's structure before reading it.
Uses tree-sitter WASM parsing to extract function/class/interface/type/property signatures with line ranges and JSDoc comments.
Returns tree-structured metadata only - no code body is included.
Use this first before ReadFile to understand a file's structure.

Supports: TypeScript (.ts), JavaScript/JSX (.js/.jsx/.mjs/.cjs), TSX (.tsx), Python (.py), Go (.go), C (.c/.h), C++ (.cpp/.cc/.cxx/.hpp/.hxx/.hh), Swift (.swift), Kotlin (.kt/.kts), Dart (.dart), Markdown (.md/.mdx/.markdown).

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
