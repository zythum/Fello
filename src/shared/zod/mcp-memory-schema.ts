import { z } from "zod";

// ── memory_query (Session Agent reads memory) ────────────────────────

export const memoryQueryRequestSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "What to search for in memory. Describe what you need to recall (e.g. 'tech stack', 'user preferences', 'build commands').",
    ),
});

export type MemoryQueryRequest = z.infer<typeof memoryQueryRequestSchema>;

export const memoryQueryRespondSchema = z.object({
  content: z.string().describe("The memory content (full or filtered)."),
});

export type MemoryQueryRespond = z.infer<typeof memoryQueryRespondSchema>;

// ── memory_store (Session Agent writes facts) ────────────────────────

export const memoryStoreRequestSchema = z.object({
  facts: z
    .array(
      z.object({
        text: z.string().max(200).describe("The fact to remember, concise and self-contained."),
        reason: z
          .string()
          .max(300)
          .optional()
          .describe(
            "Why this should be remembered — context that helps determine weight and tags (e.g. 'user explicitly corrected me', 'user emphasized with 一定/never').",
          ),
      }),
    )
    .min(1)
    .max(10)
    .describe(
      "Facts to remember. The system will organize, deduplicate, and assign priority in the background.",
    ),
});

export type MemoryStoreRequest = z.infer<typeof memoryStoreRequestSchema>;

export const memoryStoreRespondSchema = z.object({
  stored: z.number().describe("Number of facts successfully integrated."),
  summary: z.string().optional().describe("Brief confirmation of what was stored."),
});

export type MemoryStoreRespond = z.infer<typeof memoryStoreRespondSchema>;
