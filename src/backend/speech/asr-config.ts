import type { ASRConfig, RealtimeASROptions } from "unified-realtime-asr";
import type { SpeechProviderInfo } from "../../shared/schema";
import { effectiveAsrModel } from "../../shared/speech";
import type { BackendContext } from "../types";
import { optionalString, requireField } from "./util";

/**
 * 语音识别（ASR）Provider 配置 → `unified-realtime-asr` 配置的映射。
 *
 * 实时语音输入（`speech/asr-manager.ts`）与音频文件转写（`speech/transcribe.ts`）
 * 共用这里的一份映射，避免两处各写一套 provider 分支。
 */

export interface BuildConfigOverrides {
  /** 覆盖 provider 上配置的识别语言（音频文件转写允许按文件指定）。 */
  language?: string;
}

/** 本方向缺字段时的报错口径（实现与合成侧共用）。 */
function required(value: string | undefined, name: string): string {
  return requireField(value, name, "实时语音识别");
}

function buildOptions(
  provider: SpeechProviderInfo,
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
    transcriptionModel: provider.provider === "openai" ? effectiveAsrModel(provider) : undefined,
  };
}

export function buildAsrConfig(
  provider: SpeechProviderInfo,
  overrides: BuildConfigOverrides = {},
): ASRConfig {
  const options = buildOptions(provider, overrides);
  const url = optionalString(provider.baseUrl);

  switch (provider.provider) {
    case "volcengine":
      return {
        provider: "volcengine",
        apiKey: required(provider.apiKey, "API Key"),
        resourceId: optionalString(provider.asrResourceId),
        appId: optionalString(provider.appId),
        url,
        options,
      };
    case "dashscope":
      return {
        provider: "dashscope",
        apiKey: required(provider.apiKey, "API Key"),
        model: effectiveAsrModel(provider),
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

export function getActiveAsrProvider(ctx: BackendContext): SpeechProviderInfo {
  const provider = ctx.storage.getSettings().speechProviders.find((item) => item.asrEnabled);
  if (!provider) {
    throw new Error(
      "设置中没有找到语音识别（ASR）配置：当前没有启用中的 Provider。" +
        "请先在「设置 → 语音 → 识别」中配置并启用一个 Provider，然后重新调用本工具。",
    );
  }
  return provider;
}
