import { z } from "zod";

// ── MCP Server ───────────────────────────────────────────────────────

export const MEMO_WRITABLE_SERVER_DESCRIPTION =
  "Provides transactional tools for organizing project memory entries.";

export const MEMO_READ_ONLY_SERVER_DESCRIPTION =
  "Provides tools to retrieve and mark project memory entries as used.";

// ── Memory Entry Schema ──────────────────────────────────────────────

export const memoryEntrySchema = z.object({
  weight: z
    .number()
    .int()
    .min(1)
    .max(3)
    .describe(
      "Future-work impact: 3=explicit must-follow constraint, 2=stable work-shaping knowledge, 1=background context",
    ),
  text: z.string().max(512).describe("The memory fact, concise and self-contained"),
  date: z
    .string()
    .describe("Date when this fact was recorded, updated, or last marked as used (YYYY-MM-DD)"),
  tags: z
    .array(z.string())
    .describe("Open-ended semantic keywords used for retrieval; concise and reusable"),
});

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

// ── Memory File Root Schema ──────────────────────────────────────────

export const memoryFileSchema = z.object({
  version: z.number().int().describe("Schema version for future migration"),
  entries: z.array(memoryEntrySchema).describe("Persistent project memory entries"),
});

export type MemoryFile = z.infer<typeof memoryFileSchema>;

/** Current schema version */
export const MEMORY_FILE_VERSION = 1;

// ── Shared Memo Fields ───────────────────────────────────────────────

export const memoryEntryIdSchema = z
  .string()
  .length(16)
  .regex(/^[0-9a-f]{16}$/)
  .describe("Read-only ID derived by the backend from the entry text");

const mutableWeightSchema = z
  .number()
  .int()
  .min(1)
  .max(3)
  .describe(
    "New weight. Use 3 only for an explicit durable instruction or prohibition governing how the agent must act.",
  );

// ── memo_get_current ─────────────────────────────────────────────────

export const MEMO_GET_CURRENT_TOOL_DESCRIPTION =
  "Read the current project memory entries and their backend-generated, read-only IDs. Call this exactly once before any other memo tool.";

export const memoGetCurrentRequestSchema = z.object({});

export type MemoGetCurrentRequest = z.infer<typeof memoGetCurrentRequestSchema>;

export const memoGetCurrentRespondSchema = z.object({
  content: z.string().describe("JSON text containing the current entries and their read-only IDs."),
});

export type MemoGetCurrentRespond = z.infer<typeof memoGetCurrentRespondSchema>;

// ── memo_add ─────────────────────────────────────────────────────────

export const MEMO_ADD_TOOL_DESCRIPTION = `Add one new immutable memory entry to the current transaction draft. The backend generates its ID and date.
Use weight 3 only for an explicit durable instruction or prohibition governing how the agent must act. If the same text already exists, the tool reports content_exists and leaves the draft unchanged.`;

export const memoAddRequestSchema = z.object({
  text: z.string().min(1).max(512).describe("New immutable memory fact"),
  weight: mutableWeightSchema,
  tags: z
    .array(z.string().min(1))
    .min(1)
    .max(3)
    .describe("Immutable open-ended semantic keywords derived from the text"),
});

export type MemoAddRequest = z.infer<typeof memoAddRequestSchema>;

export const memoAddRespondSchema = z.object({
  ok: z.boolean(),
  id: memoryEntryIdSchema,
  error: z.literal("content_exists").optional(),
});

export type MemoAddRespond = z.infer<typeof memoAddRespondSchema>;

// ── memo_delete ──────────────────────────────────────────────────────

export const MEMO_DELETE_TOOL_DESCRIPTION =
  "Delete one entry from the current transaction draft by its read-only ID. Use delete plus add when immutable text or tags must be replaced.";

export const memoDeleteRequestSchema = z.object({
  id: memoryEntryIdSchema,
});

export type MemoDeleteRequest = z.infer<typeof memoDeleteRequestSchema>;

export const memoDeleteRespondSchema = z.object({
  ok: z.boolean(),
  id: memoryEntryIdSchema,
  error: z.literal("entry_not_found").optional(),
});

export type MemoDeleteRespond = z.infer<typeof memoDeleteRespondSchema>;

// ── memo_set_weight ──────────────────────────────────────────────────

export const MEMO_SET_WEIGHT_TOOL_DESCRIPTION = `Set one entry's weight in the current transaction draft. This always refreshes its date.
Use weight 3 only for an explicit durable instruction or prohibition governing how the agent must act; repetition, correction, urgency, or technical necessity alone never justify weight 3.`;

export const memoSetWeightRequestSchema = z.object({
  id: memoryEntryIdSchema,
  weight: mutableWeightSchema,
});

export type MemoSetWeightRequest = z.infer<typeof memoSetWeightRequestSchema>;

export const memoSetWeightRespondSchema = z.object({
  ok: z.boolean(),
  id: memoryEntryIdSchema,
  error: z.literal("entry_not_found").optional(),
});

export type MemoSetWeightRespond = z.infer<typeof memoSetWeightRespondSchema>;

// ── memo_touch ───────────────────────────────────────────────────────

export const MEMO_TOUCH_TOOL_DESCRIPTION =
  "Mark only the entries represented in the final retrieval response as used by refreshing their date. Pass their read-only IDs, not array indices.";

export const memoTouchRequestSchema = z.object({
  ids: z
    .array(memoryEntryIdSchema)
    .min(1)
    .describe("IDs of entries represented in the final response; updates their date to today"),
});

export type MemoTouchRequest = z.infer<typeof memoTouchRequestSchema>;

export const memoTouchRespondSchema = z.object({
  ok: z.boolean(),
  touched: z.number().describe("Number of entries touched"),
});

export type MemoTouchRespond = z.infer<typeof memoTouchRespondSchema>;
