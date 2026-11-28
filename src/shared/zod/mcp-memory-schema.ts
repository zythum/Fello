import { z } from "zod";

// ── MCP Server ───────────────────────────────────────────────────────

export const MEMORY_SERVER_DESCRIPTION =
  "Provides memory_query and memory_store tools for persistent project-level memory.";

// ── memory_query (Session Agent reads memory) ────────────────────────

/**
 * memory_query 工具的模型可见说明。关键记忆由主进程在启动参数中注入，
 * 故以函数形式生成，避免说明文案与注入逻辑分散在两处。
 */
export function buildMemoryQueryToolDescription(criticalMemories: string[] = []): string {
  const criticalSection =
    criticalMemories.length === 0
      ? ""
      : `

Automatically loaded critical project memories — always follow these:
${criticalMemories.map((memory) => `- ${memory.replaceAll("\n", "\n  ")}`).join("\n")}

These are only the highest-priority project constraints, not the complete project memory. Do not treat the absence of a detail here as evidence that no relevant memory exists. This list does not replace task-specific retrieval.`;

  return `Query the project's persistent memory.${criticalSection}

For every specific task, question, recommendation, or domain discussion that may depend on memory, provide a focused query. Include all relevant dimensions in that query, such as applicable conventions, preferences, decisions, corrections, architecture, or commands.

Never omit query merely to discover whether relevant memories exist. Omit it only when a broad project-memory briefing is genuinely needed, such as when the user asks what is remembered.

A focused query returns relevant details. An omitted query generates a current summary from the stored entries. In either mode, memories included in the response are marked as used.`;
}

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

export const MEMORY_STORE_TOOL_DESCRIPTION = `Store facts into persistent project memory for future sessions.

Proactively store facts worth remembering for future sessions. Common triggers:
- User states a preference, makes a choice, or corrects your behavior (even subtly)
- You discover a project convention, tech stack detail, or architectural decision
- User emphasizes something with "always", "never", "remember", "一定", "不要"
- User explicitly asks you to remember something

Also store when:
- User explains why they do something a certain way
- User mentions a tool, framework, or library choice
- You make a decision during the conversation that affects future work
- User tells you to skip or avoid something

When in doubt about whether to store — store it. Forgetting costs more than duplicating.

Each fact should be a concise, self-contained statement. Include a reason when the context helps determine importance (e.g. if the user strongly emphasized it or corrected the agent).`;

export const memoryStoreRequestSchema = z.object({
  facts: z
    .array(
      z.object({
        text: z.string().max(512).describe("The fact to remember, concise and self-contained."),
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
