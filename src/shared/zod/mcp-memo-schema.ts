import { z } from "zod";

// ── Memory Entry Schema ──────────────────────────────────────────────

export const memoryEntrySchema = z.object({
  weight: z
    .number()
    .int()
    .min(1)
    .max(3)
    .describe("Priority weight: 3=critical, 2=important, 1=general"),
  text: z.string().max(200).describe("The memory fact, concise and self-contained"),
  date: z.string().describe("Date when this fact was recorded or last updated (YYYY-MM-DD)"),
  tags: z
    .array(z.string())
    .describe("Category tags: preferences, architecture, commands, corrections, context"),
});

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

// ── Memory File Root Schema ──────────────────────────────────────────

export const memoryFileSchema = z.object({
  version: z.number().int().describe("Schema version for future migration"),
  entries: z.array(memoryEntrySchema).describe("Memory entries sorted by weight descending"),
});

export type MemoryFile = z.infer<typeof memoryFileSchema>;

/** Current schema version */
export const MEMORY_FILE_VERSION = 1;

// ── memo_get_current (Inference Agent reads memory.json) ─────────────

export const memoGetCurrentRequestSchema = z.object({});

export type MemoGetCurrentRequest = z.infer<typeof memoGetCurrentRequestSchema>;

export const memoGetCurrentRespondSchema = z.object({
  content: z.string().describe("The current memory.json content as a JSON string."),
});

export type MemoGetCurrentRespond = z.infer<typeof memoGetCurrentRespondSchema>;

// ── memo_save (Inference Agent writes memory.json) ───────────────────

export const memoSaveRequestSchema = z.object({
  content: z
    .string()
    .max(16000)
    .describe(
      "The complete memory content as a JSON string. Must conform to the memory file schema: { version, entries: [...] }",
    ),
});

export type MemoSaveRequest = z.infer<typeof memoSaveRequestSchema>;

export const memoSaveRespondSchema = z.object({
  ok: z.boolean(),
  entries: z.number().describe("Number of entries saved."),
});

export type MemoSaveRespond = z.infer<typeof memoSaveRespondSchema>;

// ── memo_touch (Inference Agent marks entries as used) ────────────────

export const memoTouchRequestSchema = z.object({
  indices: z
    .array(z.number().int().min(0))
    .min(1)
    .describe(
      "Indices of entries in the entries array that were relevant/used. Updates their date to today.",
    ),
});

export type MemoTouchRequest = z.infer<typeof memoTouchRequestSchema>;

export const memoTouchRespondSchema = z.object({
  ok: z.boolean(),
  touched: z.number().describe("Number of entries touched."),
});

export type MemoTouchRespond = z.infer<typeof memoTouchRespondSchema>;
