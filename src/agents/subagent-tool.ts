import { randomUUID } from "crypto";
import { streamText, isStepCount, type ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { AgentClientProxy } from "./agent-client-proxy";
import type { AddonSessionUpdate, SubagentStatus } from "../shared/schema";
import { createACPClientTools, closeACPClientTools } from "./acp-client-tools";
import type { ToolPermissionMemory } from "./permission";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubagentToolParams = {
  /** Main session ID (used for subagent_update notifications targeting the parent) */
  sessionId: string;
  /** Session cwd */
  cwd: string;
  /** Get the current ACP connection */
  getConnection: () => AgentClientProxy | null;
  /** Get the AI model instance */
  getModel: () => ReturnType<
    ReturnType<typeof import("@ai-sdk/openai-compatible").createOpenAICompatible>["chatModel"]
  >;
  /** System prompt for subagents */
  systemPrompt: string;
  /** Shared permission memory so subagents respect "always allow" choices */
  permissionMemory?: ToolPermissionMemory;
  /** AbortSignal from the parent session */
  parentSignal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// Connection Proxy
// ---------------------------------------------------------------------------

/**
 * Creates a proxy around AgentClientProxy that rewrites sessionId
 * in sessionUpdate and requestPermission calls to the sub-session ID.
 *
 * This ensures all tool_call updates from subagent tools appear inside
 * the subagent bubble in the UI rather than in the parent session.
 */
function createSubsessionConnectionProxy(
  getConnection: () => AgentClientProxy | null,
  parentSessionId: string,
  subSessionId: string,
): () => AgentClientProxy | null {
  return () => {
    const real = getConnection();
    if (!real) return null;
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "sessionUpdate") {
          return async (params: any) => {
            // Rewrite the sessionId from parent to sub-session
            const rewritten = { ...params };
            if (rewritten.sessionId === parentSessionId) {
              rewritten.sessionId = subSessionId;
            }
            return target.sessionUpdate(rewritten);
          };
        }
        if (prop === "requestPermission") {
          return async (params: any) => {
            const rewritten = { ...params };
            if (rewritten.sessionId === parentSessionId) {
              rewritten.sessionId = subSessionId;
            }
            return target.requestPermission(rewritten);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendSubagentStatusUpdate(
  connection: AgentClientProxy,
  sessionId: string,
  subSessionId: string,
  name: string,
  prompt: string,
  status: SubagentStatus,
): Promise<void> {
  const update: AddonSessionUpdate = {
    sessionUpdate: "subagent_update",
    sessionId: subSessionId,
    name,
    prompt,
    status,
  };
  return connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "session_info_update",
      _meta: {
        fello: {
          update,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Subagent execution
// ---------------------------------------------------------------------------

async function executeSubagent(
  params: SubagentToolParams,
  subSessionId: string,
  taskName: string,
  taskPrompt: string,
  signal: AbortSignal,
): Promise<string> {
  const connection = params.getConnection();
  if (!connection) {
    throw new Error("ACP connection is not available.");
  }

  // Notify UI: subagent is starting
  await sendSubagentStatusUpdate(
    connection,
    params.sessionId,
    subSessionId,
    taskName,
    taskPrompt,
    "in_progress",
  );

  // Create sub-session scoped ACP tools via connection proxy
  const proxyGetConnection = createSubsessionConnectionProxy(
    params.getConnection,
    params.sessionId,
    subSessionId,
  );

  const subAcp = createACPClientTools({
    cwd: params.cwd,
    sessionId: subSessionId,
    getConnection: proxyGetConnection,
    permissionMemory: params.permissionMemory,
  });

  let accumulatedText = "";

  try {
    const result = streamText({
      model: params.getModel(),
      system: params.systemPrompt,
      prompt: taskPrompt,
      tools: {
        ...subAcp.tools,
      },
      stopWhen: isStepCount(64),
      abortSignal: signal,
    });

    for await (const part of result.stream) {
      const conn = params.getConnection();
      if (!conn) continue;

      if (part.type === "text-delta") {
        if (!part.text) continue;
        accumulatedText += part.text;
        await conn.sessionUpdate({
          sessionId: subSessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: part.text },
          },
        });
        continue;
      }

      if (part.type === "reasoning-delta") {
        if (!part.text) continue;
        await conn.sessionUpdate({
          sessionId: subSessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: part.text },
          },
        });
        continue;
      }
    }

    // Mark completed
    const conn2 = params.getConnection();
    if (conn2) {
      await sendSubagentStatusUpdate(
        conn2,
        params.sessionId,
        subSessionId,
        taskName,
        taskPrompt,
        "completed",
      );
    }

    return accumulatedText || "[No output produced]";
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const conn3 = params.getConnection();
    if (conn3) {
      // Mark failed or completed (if cancelled)
      await sendSubagentStatusUpdate(
        conn3,
        params.sessionId,
        subSessionId,
        taskName,
        taskPrompt,
        signal.aborted ? "completed" : "failed",
      );

      if (!signal.aborted) {
        // Send error message to subagent bubble
        await conn3.sessionUpdate({
          sessionId: subSessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `\n\n**Error:** ${errorMessage}` },
          },
        });
      }
    }

    if (signal.aborted) {
      return accumulatedText || "[Cancelled]";
    }
    return accumulatedText || `[Error: ${errorMessage}]`;
  } finally {
    // Cleanup sub-session terminals
    await closeACPClientTools(subAcp);
  }
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function createSubagentTool(params: SubagentToolParams): ToolSet {
  return {
    Subagent: tool({
      description: `Spawn one or more independent AI sub-agents to work on tasks in parallel.
Each sub-agent runs with its own context and has access to file read/write, edit, and shell tools.
Use this when you need to:
- Parallelize independent work (e.g., implement + test, research multiple topics)
- Delegate focused sub-tasks while you coordinate the overall approach
- Run longer operations without blocking other work

Each task gets a name (short identifier) and a prompt (detailed instructions).
Sub-agents do NOT have access to the parent conversation history — include all necessary context in the prompt.
Results from all sub-agents are returned when they all complete.`,
      inputSchema: z.object({
        purpose: z.string().describe("Brief description of the purpose for spawning sub-agents."),
        tasks: z
          .array(
            z.object({
              name: z.string().describe("Short name for this sub-task (shown in UI)."),
              prompt: z
                .string()
                .describe(
                  "Detailed instructions for the sub-agent. Include all context it needs since it has no access to the parent conversation history.",
                ),
            }),
          )
          .min(1)
          .max(8)
          .describe("List of tasks to execute in parallel. Min 1, max 8."),
      }),
      execute: async ({ purpose, tasks }, { toolCallId }) => {
        const connection = params.getConnection();
        if (!connection) {
          throw new Error("ACP connection is not available.");
        }

        // Broadcast tool_call start
        const title = `Subagent: ${purpose}`;
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            title,
            kind: "other",
            status: "in_progress",
            rawInput: { purpose, tasks: tasks.map((t) => ({ name: t.name, prompt: t.prompt })) },
          },
        });

        // Create sub-session IDs and notify UI about pending subagents
        const subagents = tasks.map((task) => ({
          subSessionId: randomUUID(),
          name: task.name,
          prompt: task.prompt,
        }));

        // Send initial pending status for all subagents
        await Promise.all(
          subagents.map((sa) =>
            sendSubagentStatusUpdate(
              connection,
              params.sessionId,
              sa.subSessionId,
              sa.name,
              sa.prompt,
              "pending",
            ),
          ),
        );

        // Execute all subagents in parallel
        const results = await Promise.allSettled(
          subagents.map((sa) =>
            executeSubagent(
              params,
              sa.subSessionId,
              sa.name,
              sa.prompt,
              params.parentSignal ?? new AbortController().signal,
            ),
          ),
        );

        // Collect results
        const output = subagents.map((sa, i) => {
          const result = results[i];
          if (result.status === "fulfilled") {
            return {
              name: sa.name,
              status: "completed" as const,
              result: result.value,
            };
          }
          return {
            name: sa.name,
            status: "failed" as const,
            result: result.reason instanceof Error ? result.reason.message : String(result.reason),
          };
        });

        // Broadcast tool_call completion
        const allSucceeded = output.every((o) => o.status === "completed");
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: allSucceeded ? "completed" : "failed",
            rawOutput: output,
          },
        });

        return output;
      },
    }),
  };
}
