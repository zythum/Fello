import { encode } from "gpt-tokenizer";
import type { ModelMessage } from "ai";
import type {
  ContextCategory,
  ContextComposition,
  ContextContent,
  ToolSchemaCost,
} from "../shared/schema";

/**
 * 上下文 token 估算工具。
 *
 * Fello 不像 DeepSeek Harness 那样有「上下文组装层」直接上报逐类别 token，
 * 因此这里在每次请求时基于真实的组装输入（system 提示 / 工具 schema / 历史消息）
 * 用 gpt-tokenizer（cl100k_base）重新估算。结果为「估算值」，可能与 provider
 * 上报的真实值存在偏差（UI 标注 "estimated"）。
 */

function countTokens(value: unknown): number {
  if (value == null) return 0;
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return 0;
    return encode(text).length;
  } catch {
    // 兜底：按字符启发式（~4 字符/token）
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return Math.ceil((text?.length ?? 0) / 4);
  }
}

export interface ComposeContextInput {
  /** 已渲染的完整 system 提示文本 */
  system: string;
  /** 工具列表（MCP + ACP），每个含 name/description/parameters */
  tools: unknown[];
  /** 当前会话历史消息 */
  history: ModelMessage[];
  /** 上下文窗口大小（token） */
  windowSize: number;
}

export interface ComposeContextResult {
  composition: ContextComposition;
  topToolSchemas: ToolSchemaCost[];
}

/**
 * 将一次请求的组装输入拆分为六大类别的 token 估算。
 */
export function composeContext(input: ComposeContextInput): ComposeContextResult {
  let systemTokens = countTokens(input.system);

  const toolTokens = input.tools.map((tool) => ({
    name: (tool as { name?: string })?.name ?? "unknown",
    tokens: countTokens(tool),
  }));
  const toolsTokens = toolTokens.reduce((sum, t) => sum + t.tokens, 0);
  const topToolSchemas = [...toolTokens]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
    .map((t) => ({ name: t.name, tokens: t.tokens }));

  let userTokens = 0;
  let assistantTokens = 0;
  let toolResultsTokens = 0;
  let injectionsTokens = 0;

  for (const message of input.history) {
    const role = message.role;
    const tokens = countTokens(message);
    switch (role) {
      case "user":
        userTokens += tokens;
        break;
      case "assistant":
        assistantTokens += tokens;
        break;
      case "tool":
        toolResultsTokens += tokens;
        break;
      case "system":
        // 历史中的 system 消息（如 compact 摘要）计入系统类
        systemTokens += tokens;
        break;
      default:
        injectionsTokens += tokens;
    }
  }

  const total =
    systemTokens + toolsTokens + userTokens + assistantTokens + toolResultsTokens + injectionsTokens;

  return {
    composition: {
      system: systemTokens,
      tools: toolsTokens,
      user: userTokens,
      assistant: assistantTokens,
      toolResults: toolResultsTokens,
      injections: injectionsTokens,
      total,
      windowSize: input.windowSize,
    },
    topToolSchemas,
  };
}

/**
 * 提取上下文浏览器的真实内容（系统提示 / 工具 schema / 消息）。
 * 体积较大，调用方应仅对每回合最后一步启用。
 */
export function extractContextContent(input: {
  system: string;
  tools: unknown[];
  history: ModelMessage[];
}): ContextContent {
  const content: ContextContent = {};
  content.system = [input.system];
  if (input.tools.length > 0) {
    content.tools = input.tools.map((tool) => ({
      name: (tool as { name?: string })?.name ?? "unknown",
      schema: JSON.stringify(tool, null, 2),
    }));
  }
  const messages: ContextContent["messages"] = [];
  for (const message of input.history) {
    messages.push({
      role: message.role,
      text:
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content, null, 2),
    });
  }
  content.messages = messages;
  return content;
}

export type { ContextCategory };
