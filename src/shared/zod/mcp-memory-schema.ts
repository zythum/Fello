import { z } from "zod";

// ── memory_query (Session Agent reads memory) ────────────────────────

export const memoryQueryRequestSchema = z.object({
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Focused topic to retrieve. Required for every specific task, question, recommendation, or domain discussion; never omit it merely to discover whether relevant memories exist. Omit only when a broad project-memory briefing is genuinely needed.",
    ),
});

export type MemoryQueryRequest = z.infer<typeof memoryQueryRequestSchema>;

export const memoryQueryRespondSchema = z.object({
  content: z.string().describe("The generated project briefing or relevant memory details."),
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
            "Why this should be remembered — context that helps determine weight and tags (e.g. if the user strongly emphasized it or corrected the agent).",
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
  stored: z.number().describe("Number of facts submitted for integration."),
  message: z.string().optional().describe("Brief confirmation of the memory operation."),
});

export type MemoryStoreRespond = z.infer<typeof memoryStoreRespondSchema>;
