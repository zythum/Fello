/**
 * Token breakdown utilities for per-step and per-tool token estimation.
 *
 * Uses `gpt-tokenizer` to locally estimate token composition of input
 * (system prompt, tool definitions, history, user message) and maps
 * AI SDK step-level usage into a structured breakdown for _meta.
 */

import type { ToolSet, StepResult } from "ai";
import type {
  SessionTokenInputComposition,
  SessionTokenPerformance,
  SessionTokenStep,
  SessionTokenToolCall,
  SessionTokenToolDefinition,
  SessionTokenToolsDefinition,
} from "../shared/schema";

// ─── Lazy-loaded tokenizer ──────────────────────────────────────────────────

let _countTokens: ((text: string) => number) | null = null;
let _formatFunctionDefinitions: ((fns: readonly object[]) => string) | null = null;

async function getTokenizer() {
  if (!_countTokens) {
    const mod = await import("gpt-tokenizer");
    _countTokens = mod.countTokens;
  }
  if (!_formatFunctionDefinitions) {
    const mod = await import("gpt-tokenizer/esm/functionCalling");
    // Cast to a looser signature — we pass objects that are structurally compatible
    // but TypeScript can't verify the ChatCompletionFunctionParameters shape at compile time.
    _formatFunctionDefinitions = mod.formatFunctionDefinitions as unknown as (
      fns: readonly object[],
    ) => string;
  }
  return {
    countTokens: _countTokens!,
    formatFunctionDefinitions: _formatFunctionDefinitions!,
  };
}

// ─── Input Composition Estimation ───────────────────────────────────────────

/**
 * Estimate per-tool token costs from a ToolSet.
 * Each tool's description + JSON Schema parameters are formatted in OpenAI's
 * function-calling style and tokenized individually.
 */
export async function estimateToolsDefinitionTokens(
  tools: ToolSet,
): Promise<SessionTokenToolsDefinition> {
  const { countTokens, formatFunctionDefinitions } = await getTokenizer();

  const entries = Object.entries(tools);
  if (entries.length === 0) {
    return { total: 0, perTool: [] };
  }

  // Build function definitions in OpenAI's expected format
  const functionDefs = entries.map(([name, tool]) => ({
    name,
    description: typeof tool.description === "string" ? tool.description : undefined,
    parameters: extractJsonSchema(tool),
  }));

  // Total tokens for all tools combined (includes namespace wrapper overhead)
  const totalFormatted = formatFunctionDefinitions(functionDefs);
  const total = countTokens(totalFormatted) + 9; // FUNCTION_DEFINITION_TOKEN_OVERHEAD

  // Per-tool: format each individually and subtract namespace wrapper
  const emptyNamespaceTokens = countTokens("namespace functions {\n\n} // namespace functions");
  const perTool: SessionTokenToolDefinition[] = functionDefs.map((fn) => {
    const singleFormatted = formatFunctionDefinitions([fn]);
    const singleTotal = countTokens(singleFormatted) + 9;
    return {
      name: fn.name,
      tokens: Math.max(0, singleTotal - emptyNamespaceTokens),
    };
  });

  return { total, perTool };
}

/**
 * Estimate input composition tokens for the first step.
 */
export async function estimateInputComposition(params: {
  systemPrompt: string;
  tools: ToolSet;
  historyText: string;
  userMessageText: string;
  actualInputTokens: number;
}): Promise<SessionTokenInputComposition> {
  const { countTokens } = await getTokenizer();

  const systemPromptTokens = countTokens(params.systemPrompt) + 3; // message overhead
  const toolsDef = await estimateToolsDefinitionTokens(params.tools);
  const historyTokens = params.historyText ? countTokens(params.historyText) : 0;
  const userMessageTokens = countTokens(params.userMessageText) + 3; // message overhead
  const estimatedTotal =
    systemPromptTokens + toolsDef.total + historyTokens + userMessageTokens + 3; // request overhead

  return {
    systemPrompt: systemPromptTokens,
    toolsDefinition: toolsDef,
    history: historyTokens,
    userMessage: userMessageTokens,
    userMessageText: params.userMessageText,
    estimatedTotal,
    delta: params.actualInputTokens - estimatedTotal,
  };
}

// ─── Step-level Breakdown ───────────────────────────────────────────────────

/**
 * Build the full token breakdown from AI SDK steps.
 */
export function buildStepBreakdown(steps: ReadonlyArray<StepResult<ToolSet>>): {
  steps: SessionTokenStep[];
  performance: SessionTokenPerformance;
} {
  const stepDetails: SessionTokenStep[] = steps.map((step, idx) => {
    const next = steps[idx + 1] as StepResult<ToolSet> | undefined;
    const usage = step.usage;

    // Estimate tool call token costs
    const toolCallEstimates = buildToolCallEstimates(step, next);

    return {
      stepNumber: step.stepNumber,
      finishReason: step.finishReason,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      inputDetails: {
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? undefined,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? undefined,
        noCacheTokens: usage.inputTokenDetails?.noCacheTokens ?? undefined,
      },
      outputDetails: {
        textTokens: usage.outputTokenDetails?.textTokens ?? undefined,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? undefined,
      },
      toolCalls: toolCallEstimates,
      performance: {
        stepTimeMs: step.performance.stepTimeMs,
        responseTimeMs: step.performance.responseTimeMs,
        timeToFirstOutputMs: step.performance.timeToFirstOutputMs ?? undefined,
        outputTokensPerSecond: step.performance.outputTokensPerSecond ?? undefined,
      },
    };
  });

  const totalTimeMs = steps.reduce((sum, s) => sum + s.performance.stepTimeMs, 0);
  const lastStep = steps[steps.length - 1];
  const effectiveOutputTokensPerSecond = lastStep?.performance.effectiveOutputTokensPerSecond ?? 0;

  return {
    steps: stepDetails,
    performance: { totalTimeMs, effectiveOutputTokensPerSecond },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildToolCallEstimates(
  step: StepResult<ToolSet>,
  next: StepResult<ToolSet> | undefined,
): SessionTokenToolCall[] {
  if (step.toolCalls.length === 0) return [];

  const usage = step.usage;
  const outputTokens = usage.outputTokens ?? 0;
  const textTokens = usage.outputTokenDetails?.textTokens ?? 0;
  const reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? 0;

  // Tool call arguments output = total output - text - reasoning
  const totalToolCallOutput = Math.max(0, outputTokens - textTokens - reasoningTokens);

  // Tool result input cost = next step's input - current input - current output
  // (the model re-sends all previous context plus the new tool results)
  let totalToolResultInput = 0;
  if (next) {
    const nextInput = next.usage.inputTokens ?? 0;
    const currentInput = usage.inputTokens ?? 0;
    const currentOutput = usage.outputTokens ?? 0;
    totalToolResultInput = Math.max(0, nextInput - currentInput - currentOutput);
  }

  const count = step.toolCalls.length;
  const toolExecutionMs = step.performance.toolExecutionMs as Record<string, number> | undefined;

  return step.toolCalls.map((tc) => ({
    toolName: tc.toolName,
    args: serializeToolCallArgs(tc.input),
    argumentsOutputTokens: Math.round(totalToolCallOutput / count),
    resultInputTokens: Math.round(totalToolResultInput / count),
    executionMs: toolExecutionMs?.[tc.toolCallId] ?? undefined,
  }));
}

/**
 * Serialize a tool call's input arguments into a display-friendly string.
 * Falls back to String() when JSON serialization is not possible.
 */
function serializeToolCallArgs(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/**
 * Extract JSON Schema object from a tool's inputSchema.
 * Handles Zod schemas, plain objects, and Schema wrappers.
 */
function extractJsonSchema(tool: { inputSchema?: unknown }): object | undefined {
  const schema = tool.inputSchema;
  if (!schema) return undefined;

  // ai-sdk Schema wrapper: has a `jsonSchema` property
  if (typeof schema === "object" && schema !== null && "jsonSchema" in schema) {
    const jsonSchema = (schema as { jsonSchema: unknown }).jsonSchema;
    if (typeof jsonSchema === "object" && jsonSchema !== null) {
      return jsonSchema as object;
    }
  }

  // Zod schema: has a `_def` property — try to get JSON schema from it
  if (typeof schema === "object" && schema !== null && "_def" in schema) {
    // For Zod schemas, we can't easily extract JSON schema without zodToJsonSchema
    // Fall back to an empty parameters marker
    return undefined;
  }

  // Plain JSON schema object
  if (typeof schema === "object" && schema !== null) {
    return schema as object;
  }

  return undefined;
}

/**
 * Serialize messages to a rough text representation for token counting.
 * This is a best-effort approximation of the message content.
 */
export function serializeMessagesForCounting(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
): string {
  const serializedMessages: string[] = [];
  for (const msg of messages) {
    const serializedParts: string[] = [];

    if (typeof msg.content === "string") {
      serializedParts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === "string") {
          serializedParts.push(part);
          continue;
        }
        if (part && typeof part === "object" && "text" in part) {
          serializedParts.push(String((part as { text: unknown }).text));
          continue;
        }
        if (part != null) {
          const serializedPart = JSON.stringify(part);
          if (serializedPart !== undefined) serializedParts.push(serializedPart);
        }
      }
    } else if (msg.content != null) {
      const serializedContent = JSON.stringify(msg.content);
      if (serializedContent !== undefined) serializedParts.push(serializedContent);
    }

    if (serializedParts.length > 0) {
      const role = msg.role ? `[${msg.role}] ` : "";
      serializedMessages.push(`${role}${serializedParts.join("\n")}`);
    }
  }
  return serializedMessages.join("\n");
}
