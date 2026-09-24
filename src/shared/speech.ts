import type { SpeechProviderInfo } from "./schema";

/**
 * 语音方向（识别 / 合成）的默认值：`SpeechProviderInfo` 上对应字段留空时生效。
 *
 * 放在 shared 是因为两侧都在用，而且必须是同一份值：
 * - 主进程（`backend/speech/asr-config.ts` / `tts-config.ts`）用它决定实际发给 provider 的值
 * - 渲染层设置页用它作输入框占位符，并在列表里显示「生效中的模型 / 音色」
 */

// ── 识别（ASR） ────────────────────────────────────────────────────────
// 只有这两家有 model：volcengine 识别用资源 ID（asrResourceId）标识版本，iflytek 没有 model。

export const DASHSCOPE_ASR_MODEL = "fun-asr-flash-8k-realtime";
export const OPENAI_ASR_MODEL = "gpt-4o-transcribe";

/** provider → 识别默认模型（未配置 `asrModel` 时生效；没有 model 概念的 provider 不在此表）。 */
export const DEFAULT_ASR_MODELS: Partial<Record<SpeechProviderInfo["provider"], string>> = {
  dashscope: DASHSCOPE_ASR_MODEL,
  openai: OPENAI_ASR_MODEL,
};

/** provider → 实际生效的识别模型（没有 model 概念的 provider 返回 undefined）。 */
export function effectiveAsrModel(provider: SpeechProviderInfo): string | undefined {
  return provider.asrModel?.trim() || DEFAULT_ASR_MODELS[provider.provider];
}

// ── 合成（TTS） ────────────────────────────────────────────────────────

export const DASHSCOPE_TTS_VOICE = "longanhuan_v3.6";
export const OPENAI_TTS_VOICE = "coral";
export const IFLYTEK_TTS_VCN = "x5_lingxiaoxuan_flow";
export const VOLC_TTS_VOICE = "zh_female_vv_uranus_bigtts";

/** provider → 默认音色。 */
export const DEFAULT_TTS_VOICES: Record<SpeechProviderInfo["provider"], string> = {
  dashscope: DASHSCOPE_TTS_VOICE,
  openai: OPENAI_TTS_VOICE,
  iflytek: IFLYTEK_TTS_VCN,
  volcengine: VOLC_TTS_VOICE,
};

/** provider → 实际生效的合成音色（未配置时回落到该家默认值）。 */
export function effectiveTtsVoice(provider: SpeechProviderInfo): string {
  return provider.voice?.trim() || DEFAULT_TTS_VOICES[provider.provider];
}
