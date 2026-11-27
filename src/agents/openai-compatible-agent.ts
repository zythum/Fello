import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderMetadata } from "ai";
import type { ApiAgentInfo } from "../shared/schema";
import type { ApiLanguageModel } from "./api-language-model";
import { ApiAgent, DEFAULT_THOUGHT_LEVEL } from "./api-agent";

/**
 * 本实现对应的 `ApiAgentInfo.provider` 标识。
 * providerOptions 的命名空间是它的 camelCase 别名（`openaiCompatible`）。
 */
const PROVIDER = "openai-compatible";

/**
 * Chat Completions 协议的 API Agent（@ai-sdk/openai-compatible）。
 *
 * 会话/历史/工具/Token 统计等全部逻辑在 `ApiAgent`；这里只提供协议相关的
 * 模型工厂、请求级 providerOptions 与标题请求参数。
 */
export class OpenaiCompatibleAgent extends ApiAgent {
  private readonly provider: ReturnType<typeof createOpenAICompatible>;

  constructor(options: ApiAgentInfo) {
    if (options.provider !== PROVIDER) {
      throw new Error(`Unsupported api provider: ${options.provider}`);
    }
    super(options);
    this.provider = createOpenAICompatible({
      name: PROVIDER,
      baseURL: options.baseUrl,
      // 流式请求需带 stream_options.include_usage，否则 vLLM 等服务端
      // 不会在流中返回 usage，导致整轮 token 用量为 0。
      includeUsage: true,
      apiKey: options.apiKey,
      headers: this.requestHeaders(),
    });
  }

  protected createModel(modelId: string): ApiLanguageModel {
    return this.provider.chatModel(modelId);
  }

  /** 会话 thought level → 请求级 providerOptions（`openaiCompatible` 命名空间）。 */
  protected buildReasoningProviderOptions(
    thoughtLevel: string | undefined,
  ): ProviderMetadata | undefined {
    if (!thoughtLevel || thoughtLevel === DEFAULT_THOUGHT_LEVEL) return undefined;
    return { openaiCompatible: { reasoningEffort: thoughtLevel } };
  }

  /** 标题生成请求的 providerOptions：尽量压低推理开销。 */
  protected buildTitleProviderOptions(): ProviderMetadata {
    // Chat Completions 用厂商通用的关闭思考字段。
    return {
      openaiCompatible: {
        thinking: { type: "disabled" },
        enable_thinking: false,
        reasoningEffort: "low",
      },
    };
  }

  /** 标题生成请求的输出上限；思考已关闭，100 足够。 */
  protected get titleMaxOutputTokens(): number {
    return 100;
  }
}
