import type { LanguageModel } from "ai";

/**
 * API agent 实际使用的模型实例类型。
 *
 * AI SDK 的 `LanguageModel` 还允许直接传模型 ID 字符串；而 Chat Completions
 * (`chatModel()`) 与 Open Responses 的 provider 工厂都返回实例，这里用 Exclude
 * 收窄，使 image-tools / subagent-tool 仍可安全读取 `provider` / `modelId`。
 */
export type ApiLanguageModel = Exclude<LanguageModel, string>;
