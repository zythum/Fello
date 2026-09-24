import type { TTSConfig } from "unified-realtime-asr";
import type { SpeechProviderInfo } from "../../shared/schema";
import type { BackendContext } from "../types";

/**
 * 语音合成 Provider 配置 → `unified-realtime-asr` `TTSConfig` 的映射。
 *
 * 凭证与实时识别（STT）同源：同一把 API Key / 应用三元组，库文档明确按此设计。
 * 与 STT 映射（`config.ts`）刻意不复用的地方：
 * - volcengine 的 `resourceId` 是识别专用（`volc.seedasr.sauc.duration`），
 *   合成不传，走库默认 `seed-tts-2.0`
 * - `ttsModel` 留空时由各家适配器使用**合成**默认模型（如 dashscope
 *   `qwen-audio-3.0-tts-flash`、openai `gpt-4o-mini-tts`），不与识别默认混淆
 * - 输出格式固定 `pcm`（流式播放最省事，渲染层 Web Audio 直接吃）
 */

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function required(value: string | undefined, name: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`语音合成配置缺少 ${name}。`);
  return result;
}

export function buildTtsConfig(provider: SpeechProviderInfo): TTSConfig {
  const options = {
    voice: required(provider.voice, "音色 (voice)"),
    format: "pcm" as const,
    language: optionalString(provider.language),
    autoReconnect: false,
  };
  const baseUrl = optionalString(provider.baseUrl);

  switch (provider.provider) {
    case "volcengine":
      return {
        provider: "volcengine",
        apiKey: required(provider.apiKey, "API Key"),
        appId: optionalString(provider.appId),
        // 双向流式：文本可增量输入，配合逐句 flush 延迟最低
        mode: "duplex",
        url: baseUrl,
        options,
      };
    case "dashscope":
      return {
        provider: "dashscope",
        apiKey: required(provider.apiKey, "API Key"),
        model: optionalString(provider.ttsModel),
        workspaceId: optionalString(provider.workspaceId),
        region: provider.region,
        workspace: optionalString(provider.workspace),
        url: baseUrl,
        options,
      };
    case "openai":
      return {
        provider: "openai",
        apiKey: required(provider.apiKey, "API Key"),
        model: optionalString(provider.ttsModel),
        baseUrl,
        options,
      };
    case "iflytek":
      return {
        provider: "iflytek",
        appId: required(provider.appId, "App ID"),
        apiKey: required(provider.apiKey, "API Key"),
        apiSecret: required(provider.apiSecret, "API Secret"),
        url: baseUrl,
        options,
      };
  }
}

export function getActiveTtsProvider(ctx: BackendContext): SpeechProviderInfo {
  const provider = ctx.storage.getSettings().speechProviders.find((item) => item.ttsEnabled);
  if (!provider) {
    throw new Error(
      "设置中没有找到语音合成（TTS）配置：当前没有启用中的 Provider。" +
        "请先在「设置 → 语音 → 合成」中配置并启用一个 Provider，然后重试。",
    );
  }
  return provider;
}
