import type { ASRConfig, RealtimeASROptions } from "unified-realtime-asr";
import type { SpeechToTextProviderInfo } from "../../shared/schema";
import type { BackendContext } from "../types";

/**
 * 语音识别 Provider 配置 → `unified-realtime-asr` 配置的映射。
 *
 * 实时语音输入（`speech/manager.ts`）与音频文件转写（`speech/transcribe.ts`）
 * 共用这里的一份映射，避免两处各写一套 provider 分支。
 */

export const DEFAULT_DASHSCOPE_MODEL = "fun-asr-flash-8k-realtime";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-transcribe";

export interface BuildConfigOverrides {
  /** 覆盖 provider 上配置的识别语言（音频文件转写允许按文件指定）。 */
  language?: string;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function required(value: string | undefined, name: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`实时语音识别配置缺少 ${name}。`);
  return result;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildOptions(
  provider: SpeechToTextProviderInfo,
  overrides: BuildConfigOverrides = {},
): RealtimeASROptions {
  return {
    language: optionalString(overrides.language) ?? optionalString(provider.language) ?? "zh-CN",
    sampleRate: 16000,
    channels: 1,
    format: "pcm",
    interimResults: true,
    punctuation: true,
    autoReconnect: false,
    transcriptionModel:
      provider.provider === "openai"
        ? (optionalString(provider.model) ?? DEFAULT_OPENAI_MODEL)
        : undefined,
  };
}

export function buildConfig(
  provider: SpeechToTextProviderInfo,
  overrides: BuildConfigOverrides = {},
): ASRConfig {
  const options = buildOptions(provider, overrides);
  const url = optionalString(provider.baseUrl);

  switch (provider.provider) {
    case "volcengine":
      return {
        provider: "volcengine",
        apiKey: required(provider.apiKey, "API Key"),
        resourceId: optionalString(provider.resourceId),
        appId: optionalString(provider.appId),
        url,
        options,
      };
    case "dashscope":
      return {
        provider: "dashscope",
        apiKey: required(provider.apiKey, "API Key"),
        model: optionalString(provider.model) ?? DEFAULT_DASHSCOPE_MODEL,
        workspaceId: optionalString(provider.workspaceId),
        region: provider.region,
        workspace: optionalString(provider.workspace),
        url,
        options,
      };
    case "openai":
      return {
        provider: "openai",
        apiKey: required(provider.apiKey, "API Key"),
        url,
        options,
      };
    case "iflytek":
      return {
        provider: "iflytek",
        appId: required(provider.appId, "App ID"),
        apiKey: required(provider.apiKey, "API Key"),
        apiSecret: required(provider.apiSecret, "API Secret"),
        url,
        options,
      };
  }
}

export function getActiveProvider(ctx: BackendContext): SpeechToTextProviderInfo {
  const provider = ctx.storage.getSettings().speechToText.find((item) => item.active);
  if (!provider) {
    throw new Error(
      "设置中没有找到语音识别（ASR）配置：当前没有启用中的 Provider。" +
        "请先在「设置 → 语音识别」中配置并启用一个 Provider，然后重新调用本工具。",
    );
  }
  return provider;
}
