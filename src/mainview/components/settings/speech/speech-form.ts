import { z } from "zod";
import type { SpeechProviderInfo } from "../../../../shared/schema";

export const speechProviderValues = ["dashscope", "volcengine", "openai", "iflytek"] as const;
export type SpeechProviderId = (typeof speechProviderValues)[number];

export const speechRegionValues = ["", "cn-beijing", "ap-southeast-1"] as const;

/**
 * Provider 表单产出的草稿：除 `id` 外的全部字段。
 * `id` 由 Dialog 决定（新增则生成，编辑则沿用原 id），表单不关心。
 *
 * 识别与合成合并为一条记录后，表单同时覆盖两个方向的字段：
 * - 共享凭证：apiKey / appId / apiSecret / baseUrl / workspace* / language
 * - 识别：asrEnabled + asrModel | asrResourceId（仅各自适用的 provider 暴露）
 * - 合成：ttsEnabled + voice（留空用各家默认音色）+ ttsModel
 * 不适用的字段显式置 undefined，避免切换 provider 时残留旧值。
 */
export type SpeechProviderDraft = Omit<SpeechProviderInfo, "id">;

/** 弹窗内每个 Provider 表单共用的 props。 */
export interface SpeechProviderFormProps {
  open: boolean;
  /** 编辑起点：已有 Provider（字段原样读过来，切换服务商时可复用同名凭据）或 null（新增）。 */
  initial: SpeechProviderInfo | null;
  /**
   * 名称初值。只在「打开弹窗 / 切换服务商」时变化：
   * 名称是表单自己的字段，若随每次输入回传 Dialog，会让 reset 反复执行并清掉其它未保存的输入。
   */
  seededName: string;
  onSave: (draft: SpeechProviderDraft) => void | Promise<void>;
  /** 服务商被改选：带上此刻的名称，Dialog 据此换成对应 Provider 的表单。 */
  onProviderChange: (provider: SpeechProviderId, name: string) => void;
}

const nameField = z.string().trim().min(1, "settings.speech.validation.enterName");
const providerField = z.enum(speechProviderValues, "settings.speech.validation.selectProvider");

// ── DashScope（通义） ──────────────────────────────────────────────────
// 识别：asrModel；合成：voice + ttsModel；两侧共用 workspaceId/region/workspace/language。

export const speechDashscopeSchema = z
  .object({
    name: nameField,
    provider: providerField,
    apiKey: z.string().trim().min(1, "settings.speech.validation.enterApiKey"),
    workspaceId: z.string(),
    region: z.enum(speechRegionValues),
    workspace: z.string(),
    language: z.string(),
    asrEnabled: z.boolean(),
    asrModel: z.string(),
    ttsEnabled: z.boolean(),
    voice: z.string(),
    ttsModel: z.string(),
  })
export type SpeechDashscopeFormValues = z.input<typeof speechDashscopeSchema>;

export function speechDashscopeDefaultValues(): SpeechDashscopeFormValues {
  return {
    name: "",
    provider: "dashscope",
    apiKey: "",
    workspaceId: "",
    region: "",
    workspace: "",
    language: "",
    asrEnabled: false,
    asrModel: "",
    ttsEnabled: false,
    voice: "",
    ttsModel: "",
  };
}

export function speechDashscopeFromProvider(
  provider: SpeechProviderInfo | null,
): SpeechDashscopeFormValues {
  return {
    name: provider?.name ?? "",
    provider: "dashscope",
    apiKey: provider?.apiKey ?? "",
    workspaceId: provider?.workspaceId ?? "",
    region: provider?.region ?? "",
    workspace: provider?.workspace ?? "",
    language: provider?.language ?? "",
    asrEnabled: provider?.asrEnabled ?? false,
    asrModel: provider?.asrModel ?? "",
    ttsEnabled: provider?.ttsEnabled ?? false,
    voice: provider?.voice ?? "",
    ttsModel: provider?.ttsModel ?? "",
  };
}

export function speechDashscopeToDraft(values: SpeechDashscopeFormValues): SpeechProviderDraft {
  return {
    name: values.name.trim(),
    provider: "dashscope",
    apiKey: values.apiKey.trim(),
    workspaceId: values.workspaceId.trim() || undefined,
    region: values.region || undefined,
    workspace: values.workspace.trim() || undefined,
    language: values.language.trim() || undefined,
    asrEnabled: values.asrEnabled,
    asrModel: values.asrModel.trim() || undefined,
    ttsEnabled: values.ttsEnabled,
    voice: values.voice.trim() || undefined,
    ttsModel: values.ttsModel.trim() || undefined,
  };
}

// ── Volcengine（火山引擎） ─────────────────────────────────────────────
// 识别：asrResourceId（资源版本，如 volc.seedasr.sauc.duration）；
// 合成：只有 voice —— 资源版本由库默认（seed-tts-2.0），没有 model。

export const speechVolcengineSchema = z
  .object({
    name: nameField,
    provider: providerField,
    apiKey: z.string().trim().min(1, "settings.speech.validation.enterApiKey"),
    appId: z.string(),
    baseUrl: z.string(),
    language: z.string(),
    asrEnabled: z.boolean(),
    asrResourceId: z.string(),
    ttsEnabled: z.boolean(),
    voice: z.string(),
  })
export type SpeechVolcengineFormValues = z.input<typeof speechVolcengineSchema>;

export function speechVolcengineDefaultValues(): SpeechVolcengineFormValues {
  return {
    name: "",
    provider: "volcengine",
    apiKey: "",
    appId: "",
    baseUrl: "",
    language: "",
    asrEnabled: false,
    asrResourceId: "",
    ttsEnabled: false,
    voice: "",
  };
}

export function speechVolcengineFromProvider(
  provider: SpeechProviderInfo | null,
): SpeechVolcengineFormValues {
  return {
    name: provider?.name ?? "",
    provider: "volcengine",
    apiKey: provider?.apiKey ?? "",
    appId: provider?.appId ?? "",
    baseUrl: provider?.baseUrl ?? "",
    language: provider?.language ?? "",
    asrEnabled: provider?.asrEnabled ?? false,
    asrResourceId: provider?.asrResourceId ?? "",
    ttsEnabled: provider?.ttsEnabled ?? false,
    voice: provider?.voice ?? "",
  };
}

export function speechVolcengineToDraft(
  values: SpeechVolcengineFormValues,
): SpeechProviderDraft {
  return {
    name: values.name.trim(),
    provider: "volcengine",
    apiKey: values.apiKey.trim(),
    appId: values.appId.trim() || undefined,
    baseUrl: values.baseUrl.trim().replace(/\/+$/, "") || undefined,
    language: values.language.trim() || undefined,
    asrEnabled: values.asrEnabled,
    asrResourceId: values.asrResourceId.trim() || undefined,
    ttsEnabled: values.ttsEnabled,
    voice: values.voice.trim() || undefined,
  };
}

// ── OpenAI ─────────────────────────────────────────────────────────────
// 识别模型走 transcriptionModel（gpt-4o-transcribe），合成模型走 model（gpt-4o-mini-tts）。

export const speechOpenaiSchema = z
  .object({
    name: nameField,
    provider: providerField,
    apiKey: z.string().trim().min(1, "settings.speech.validation.enterApiKey"),
    baseUrl: z.string(),
    language: z.string(),
    asrEnabled: z.boolean(),
    asrModel: z.string(),
    ttsEnabled: z.boolean(),
    voice: z.string(),
    ttsModel: z.string(),
  })
export type SpeechOpenaiFormValues = z.input<typeof speechOpenaiSchema>;

export function speechOpenaiDefaultValues(): SpeechOpenaiFormValues {
  return {
    name: "",
    provider: "openai",
    apiKey: "",
    baseUrl: "",
    language: "",
    asrEnabled: false,
    asrModel: "",
    ttsEnabled: false,
    voice: "",
    ttsModel: "",
  };
}

export function speechOpenaiFromProvider(
  provider: SpeechProviderInfo | null,
): SpeechOpenaiFormValues {
  return {
    name: provider?.name ?? "",
    provider: "openai",
    apiKey: provider?.apiKey ?? "",
    baseUrl: provider?.baseUrl ?? "",
    language: provider?.language ?? "",
    asrEnabled: provider?.asrEnabled ?? false,
    asrModel: provider?.asrModel ?? "",
    ttsEnabled: provider?.ttsEnabled ?? false,
    voice: provider?.voice ?? "",
    ttsModel: provider?.ttsModel ?? "",
  };
}

export function speechOpenaiToDraft(values: SpeechOpenaiFormValues): SpeechProviderDraft {
  return {
    name: values.name.trim(),
    provider: "openai",
    apiKey: values.apiKey.trim(),
    baseUrl: values.baseUrl.trim().replace(/\/+$/, "") || undefined,
    language: values.language.trim() || undefined,
    asrEnabled: values.asrEnabled,
    asrModel: values.asrModel.trim() || undefined,
    ttsEnabled: values.ttsEnabled,
    voice: values.voice.trim() || undefined,
    ttsModel: values.ttsModel.trim() || undefined,
  };
}

// ── IFlytek（讯飞） ────────────────────────────────────────────────────
// 两侧都是应用三元组（App ID / API Key / API Secret），且都没有 model；
// 合成侧的差异只在发音人（voice）授权。

export const speechIflytekSchema = z
  .object({
    name: nameField,
    provider: providerField,
    appId: z.string().trim().min(1, "settings.speech.validation.enterAppId"),
    apiKey: z.string().trim().min(1, "settings.speech.validation.enterApiKey"),
    apiSecret: z.string().trim().min(1, "settings.speech.validation.enterApiSecret"),
    baseUrl: z.string(),
    language: z.string(),
    asrEnabled: z.boolean(),
    ttsEnabled: z.boolean(),
    voice: z.string(),
  })
export type SpeechIflytekFormValues = z.input<typeof speechIflytekSchema>;

export function speechIflytekDefaultValues(): SpeechIflytekFormValues {
  return {
    name: "",
    provider: "iflytek",
    appId: "",
    apiKey: "",
    apiSecret: "",
    baseUrl: "",
    language: "",
    asrEnabled: false,
    ttsEnabled: false,
    voice: "",
  };
}

export function speechIflytekFromProvider(
  provider: SpeechProviderInfo | null,
): SpeechIflytekFormValues {
  return {
    name: provider?.name ?? "",
    provider: "iflytek",
    appId: provider?.appId ?? "",
    apiKey: provider?.apiKey ?? "",
    apiSecret: provider?.apiSecret ?? "",
    baseUrl: provider?.baseUrl ?? "",
    language: provider?.language ?? "",
    asrEnabled: provider?.asrEnabled ?? false,
    ttsEnabled: provider?.ttsEnabled ?? false,
    voice: provider?.voice ?? "",
  };
}

export function speechIflytekToDraft(values: SpeechIflytekFormValues): SpeechProviderDraft {
  return {
    name: values.name.trim(),
    provider: "iflytek",
    appId: values.appId.trim(),
    apiKey: values.apiKey.trim(),
    apiSecret: values.apiSecret.trim(),
    baseUrl: values.baseUrl.trim().replace(/\/+$/, "") || undefined,
    language: values.language.trim() || undefined,
    asrEnabled: values.asrEnabled,
    ttsEnabled: values.ttsEnabled,
    voice: values.voice.trim() || undefined,
  };
}
