import { z } from "zod";

export const searchRequestSchema = z.object({
  pattern: z.string().describe("Search pattern (literal text by default, set regex=true for regex)."),
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

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const searchRespondSchema = z.object({
  output: z.string(),
  code: z.number(),
});

export type SearchRespond = z.infer<typeof searchRespondSchema>;

export const rgRequestSchema = z.object({
  args: z
    .array(z.string())
    .describe(
      "Raw ripgrep CLI arguments (e.g. ['-i', 'pattern', 'src/']). The pattern and path are included in this array.",
    ),
});

export type RgRequest = z.infer<typeof rgRequestSchema>;

export const rgRespondSchema = z.object({
  output: z.string(),
  code: z.number(),
  stderr: z.string().optional(),
});

export type RgRespond = z.infer<typeof rgRespondSchema>;

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
