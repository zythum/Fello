import { z } from "zod";

// ── MCP Server ───────────────────────────────────────────────────────

export const SEARCH_SERVER_DESCRIPTION =
  "Search file contents and inspect file structure. Provides grep (pattern search), glob (file finder), and file_outline (AST-based file structure preview).";

// ── Grep ─────────────────────────────────────────────────────────────

export const GREP_TOOL_DESCRIPTION = `Search file contents for common patterns using ripgrep.
Fast, respects .gitignore, skips hidden/binary files by default.
Pattern is treated as literal text by default. Set regex=true if you need regex.

The path parameter accepts:
- Relative path (relative to project root): "src/", "./lib"
- Absolute path (POSIX or Windows): "/Users/me/project/src", "C:\\project\\src"
- file:// URI: "file:///Users/me/project/src"`;

export const grepRequestSchema = z.object({
  pattern: z
    .string()
    .describe("Search pattern (literal text by default, set regex=true for regex)."),
  path: z
    .string()
    .describe(
      "Directory or file(s) to search. Accepts: relative path (relative to project root), absolute path (POSIX or Windows), or file:// URI.",
    ),
  ignoreCase: z.boolean().optional().describe("Case insensitive search (-i)."),
  regex: z.boolean().optional().describe("Treat pattern as regex instead of literal text."),
  type: z.string().optional().describe("File type filter: ts, js, py, rs, go, md, etc (-t)."),
  glob: z.string().optional().describe("Glob filter: *.test.ts, *.spec.js (-g)."),
  context: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Lines of context before and after each match (-C)."),
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max number of matching lines to return (-m)."),
  maxColumns: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Max bytes per output line (-M). Longer lines are previewed and cut with '[... omitted end of long line]'. Default: 1024. Set 0 to disable.",
    ),
  listFiles: z
    .boolean()
    .optional()
    .describe("Only list file paths with matches, not content (-l)."),
  invertMatch: z.boolean().optional().describe("Show lines that do NOT match the pattern (-v)."),
  wordMatch: z.boolean().optional().describe("Only match whole words (-w)."),
});

export type GrepRequest = z.infer<typeof grepRequestSchema>;

export const grepRespondSchema = z.object({
  output: z.string(),
  code: z.number(),
});

export type GrepRespond = z.infer<typeof grepRespondSchema>;

// ── Glob ─────────────────────────────────────────────────────────────

export const GLOB_TOOL_DESCRIPTION = `Find files and directories whose paths match a glob pattern. Respects .gitignore.

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
`;

export const globRequestSchema = z.object({
  pattern: z.string().describe("Glob pattern, e.g. '**/*.rs', 'src/**/*.{ts,tsx}'."),
  path: z.string().optional().describe("Root directory to search from. Defaults to project root."),
  limit: z.number().int().positive().optional().describe("Maximum number of results to return."),
  maxDepth: z.number().int().positive().optional().describe("Maximum directory depth to traverse."),
  dot: z
    .boolean()
    .optional()
    .describe("Include dotfiles (hidden files/directories). Default: false."),
  onlyFiles: z
    .boolean()
    .optional()
    .describe("Only match files, not directories. Default: false (includes directories)."),
  gitignore: z.boolean().optional().describe("Respect .gitignore patterns. Default: true."),
});

export type GlobRequest = z.infer<typeof globRequestSchema>;

export const globRespondSchema = z.object({
  filePaths: z.array(z.string()),
  totalFiles: z.number(),
  truncated: z.boolean(),
});

export type GlobRespond = z.infer<typeof globRespondSchema>;

// ── File Outline ─────────────────────────────────────────────────────

export const FILE_OUTLINE_TOOL_DESCRIPTION = `Get a structural outline of a file WITHOUT reading its full content.
Use this to understand a file's structure before reading it.
Uses tree-sitter WASM parsing to extract function/class/interface/type/property signatures with line ranges and JSDoc comments.
Returns tree-structured metadata only - no code body is included.
Use this first before ReadFile to understand a file's structure.

Supports: TypeScript (.ts), JavaScript/JSX (.js/.jsx/.mjs/.cjs), TSX (.tsx), Python (.py), Go (.go), C (.c/.h), C++ (.cpp/.cc/.cxx/.hpp/.hxx/.hh), Swift (.swift), Kotlin (.kt/.kts), Dart (.dart), Markdown (.md/.mdx/.markdown).

The path parameter accepts:
- Relative path (relative to project root): "src/app.ts", "./lib/utils.ts"
- Absolute path (POSIX or Windows): "/Users/me/project/src/app.ts", "C:\\project\\src\\app.ts"
- file:// URI: "file:///Users/me/project/src/app.ts"`;

export const fileOutlineRequestSchema = z.object({
  path: z
    .string()
    .describe(
      "File path to analyze. Accepts: relative path (relative to project root), absolute path (POSIX or Windows), or file:// URI.",
    ),
});

export type FileOutlineRequest = z.infer<typeof fileOutlineRequestSchema>;

export const fileOutlineRespondSchema = z.object({
  outline: z.string().describe("Structural outline of the file in text format."),
});

export type FileOutlineRespond = z.infer<typeof fileOutlineRespondSchema>;
