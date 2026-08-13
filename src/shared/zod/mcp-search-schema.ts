import { z } from "zod";

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

// ── Glob ──────────────────────────────────────────────────────────────

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
