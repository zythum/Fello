import type { TTSConfig } from "unified-realtime-asr";
import type { SpeechProviderInfo } from "../../shared/schema";
import { effectiveTtsVoice } from "../../shared/speech";
import type { BackendContext } from "../types";
import { optionalString, requireField } from "./util";

/**
 * 语音合成 Provider 配置 → `unified-realtime-asr` `TTSConfig` 的映射。
 *
 * 凭证与实时识别（ASR）同源：同一把 API Key / 应用三元组，库文档明确按此设计。
 * 与 ASR 映射（`asr-config.ts`）刻意不复用的地方：
 * - volcengine 的 `resourceId` 是识别专用（`volc.seedasr.sauc.duration`），
 *   合成不传，走库默认 `seed-tts-2.0`
 * - `ttsModel` 留空时由各家适配器使用**合成**默认模型（如 dashscope
 *   `qwen-audio-3.0-tts-flash`、openai `gpt-4o-mini-tts`），不与识别默认混淆
 * - `voice` 留空时回落到 `shared/speech.ts` 的各家默认音色（设置页展示 / 占位符同一份值）
 * - 输出格式固定 `pcm`（流式播放最省事，渲染层 Web Audio 直接吃）
 */

/** 本方向缺字段时的报错口径（实现与识别侧共用）。 */
function required(value: string | undefined, name: string): string {
  return requireField(value, name, "语音合成");
}

export function buildTtsConfig(provider: SpeechProviderInfo): TTSConfig {
  const options = {
    voice: effectiveTtsVoice(provider),
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
