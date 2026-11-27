import { createOpenResponses } from "@ai-sdk/open-responses";
import type { ProviderMetadata } from "ai";
import type { ApiAgentInfo } from "../shared/schema";
import type { ApiLanguageModel } from "./api-language-model";
import { ApiAgent, DEFAULT_THOUGHT_LEVEL } from "./api-agent";

/**
 * 本实现对应的 `ApiAgentInfo.provider` 标识。
 * 同时是 providerOptions 的命名空间：历史里的 itemId、推理密文都按它读写，
 * 改名会让已持久化的历史元数据对不上。
 */
const PROVIDER = "open-responses";

/**
 * Responses 端点固定为 `{baseUrl}/responses`。与 Chat Completions 一致，
 * baseUrl 只填 `https://api.x.ai/v1` 这类前缀，不做完整端点探测。
 */
function resolveResponsesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/responses`;
}

/**
 * 会话 thought level → Responses 的 reasoningEffort。
 *
 * Responses 生态没有统一的 "max"（xAI 最高是 xhigh、OpenAI 最高是 high），
 * 直接发送会被服务端判为非法参数，这里折成通用的 high。
 */
function toResponsesReasoningEffort(thoughtLevel: string): string {
  return thoughtLevel === "max" ? "high" : thoughtLevel;
}

/**
 * Open Responses 协议的 API Agent（@ai-sdk/open-responses）。
 *
 * 会话/历史/工具/Token 统计等全部逻辑在 `ApiAgent`；这里只提供协议相关的
 * 模型工厂、请求级 providerOptions 与标题请求参数。
 *
 * 适合 xAI Grok 这类推荐 Responses 端点、且只有该端点返回加密推理内容的厂商。
 */
export class OpenResponsesAgent extends ApiAgent {
  private readonly provider: ReturnType<typeof createOpenResponses>;

  constructor(options: ApiAgentInfo) {
    if (options.provider !== PROVIDER) {
      throw new Error(`Unsupported api provider: ${options.provider}`);
    }
    super(options);
    this.provider = createOpenResponses({
      name: PROVIDER,
      url: resolveResponsesUrl(options.baseUrl),
      apiKey: options.apiKey,
      headers: this.requestHeaders(),
    });
  }

  protected createModel(modelId: string): ApiLanguageModel {
    return this.provider(modelId);
  }

  /** 会话 thought level → 请求级 providerOptions（`open-responses` 命名空间）。 */
  protected buildReasoningProviderOptions(
    thoughtLevel: string | undefined,
  ): ProviderMetadata | undefined {
    if (!thoughtLevel || thoughtLevel === DEFAULT_THOUGHT_LEVEL) return undefined;
    return {
      [PROVIDER]: { reasoningEffort: toResponsesReasoningEffort(thoughtLevel) },
    };
  }

  /** 标题生成请求的 providerOptions：尽量压低推理开销。 */
  protected buildTitleProviderOptions(): ProviderMetadata {
    // 该协议的选项 schema 只接受 reasoningEffort / reasoningSummary。
    return { [PROVIDER]: { reasoningEffort: "low" } };
  }

  /** 标题生成请求的输出上限；推理无法关闭，需给推理留预算。 */
  protected get titleMaxOutputTokens(): number {
    return 512;
  }
}
