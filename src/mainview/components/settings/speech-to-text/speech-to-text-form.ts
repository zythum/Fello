import { z } from "zod";
import type { SpeechToTextProviderInfo } from "../../../../shared/schema";

export const speechToTextProviderValues = ["dashscope", "volcengine", "openai", "iflytek"] as const;
export type SpeechToTextProviderId = (typeof speechToTextProviderValues)[number];

export const speechToTextRegionValues = ["", "cn-beijing", "ap-southeast-1"] as const;

/**
 * Provider 特有的表单字段部分（不含 id/name/provider/active）。
 * 各 Provider 的 toProviderPart 返回值都兼容该类型，Dialog 汇总时统一使用。
 */
export type SpeechToTextProviderPart = Omit<
  SpeechToTextProviderInfo,
  "id" | "name" | "provider" | "active"
>;

/** Provider 表单把自身 handleSubmit 暴露给 Dialog 提交链路的引用。 */
export type ProviderSubmitRef = { current: (() => Promise<void>) | null };

// ── 公共字段（名称 / 服务商） ──────────────────────────────────────────

export const speechToTextCommonSchema = z.object({
  name: z.string().trim().min(1, "settings.speechToText.validation.enterName"),
  provider: z.enum(speechToTextProviderValues, "settings.speechToText.validation.selectProvider"),
});
export type SpeechToTextCommonValues = z.input<typeof speechToTextCommonSchema>;

// ── DashScope（通义） ──────────────────────────────────────────────────

export const dashscopeSchema = z.object({
  apiKey: z.string().trim().min(1, "settings.speechToText.validation.enterApiKey"),
  model: z.string(),
  workspaceId: z.string(),
  region: z.enum(speechToTextRegionValues),
  workspace: z.string(),
  language: z.string(),
});
export type DashScopeFormValues = z.input<typeof dashscopeSchema>;
export type DashScopeProviderPart = Pick<
  SpeechToTextProviderInfo,
  "apiKey" | "model" | "workspaceId" | "region" | "workspace" | "language"
>;

export function dashscopeDefaultValues(): DashScopeFormValues {
  return {
    apiKey: "",
    model: "",
    workspaceId: "",
    region: "",
    workspace: "",
    language: "",
  };
}

export function dashscopeFromProvider(
  provider: SpeechToTextProviderInfo | null,
): DashScopeFormValues {
  return {
    apiKey: provider?.apiKey ?? "",
    model: provider?.model ?? "",
    workspaceId: provider?.workspaceId ?? "",
    region: provider?.region ?? "",
    workspace: provider?.workspace ?? "",
    language: provider?.language ?? "",
  };
}

export function dashscopeToProviderPart(values: DashScopeFormValues): DashScopeProviderPart {
  return {
    apiKey: values.apiKey.trim(),
    model: values.model.trim() || undefined,
    workspaceId: values.workspaceId.trim() || undefined,
    region: values.region || undefined,
    workspace: values.workspace.trim() || undefined,
    language: values.language.trim() || undefined,
  };
}

// ── Volcengine（火山引擎） ──────────────────────────────────────────────

export const volcengineSchema = z.object({
  apiKey: z.string().trim().min(1, "settings.speechToText.validation.enterApiKey"),
  appId: z.string(),
  resourceId: z.string(),
  baseUrl: z.string(),
  language: z.string(),
});
export type VolcengineFormValues = z.input<typeof volcengineSchema>;
export type VolcengineProviderPart = Pick<
  SpeechToTextProviderInfo,
  "apiKey" | "appId" | "resourceId" | "baseUrl" | "language"
>;

export function volcengineDefaultValues(): VolcengineFormValues {
  return { apiKey: "", appId: "", resourceId: "", baseUrl: "", language: "" };
}

export function volcengineFromProvider(
  provider: SpeechToTextProviderInfo | null,
): VolcengineFormValues {
  return {
    apiKey: provider?.apiKey ?? "",
    appId: provider?.appId ?? "",
    resourceId: provider?.resourceId ?? "",
    baseUrl: provider?.baseUrl ?? "",
    language: provider?.language ?? "",
  };
}

export function volcengineToProviderPart(values: VolcengineFormValues): VolcengineProviderPart {
  return {
    apiKey: values.apiKey.trim(),
    appId: values.appId.trim() || undefined,
    resourceId: values.resourceId.trim() || undefined,
    baseUrl: values.baseUrl.trim().replace(/\/+$/, "") || undefined,
    language: values.language.trim() || undefined,
  };
}

// ── OpenAI ─────────────────────────────────────────────────────────────

export const openaiSchema = z.object({
  apiKey: z.string().trim().min(1, "settings.speechToText.validation.enterApiKey"),
  model: z.string(),
  baseUrl: z.string(),
  language: z.string(),
});
export type OpenAIFormValues = z.input<typeof openaiSchema>;
export type OpenAIProviderPart = Pick<
  SpeechToTextProviderInfo,
  "apiKey" | "model" | "baseUrl" | "language"
>;

export function openaiDefaultValues(): OpenAIFormValues {
  return { apiKey: "", model: "", baseUrl: "", language: "" };
}

export function openaiFromProvider(provider: SpeechToTextProviderInfo | null): OpenAIFormValues {
  return {
    apiKey: provider?.apiKey ?? "",
    model: provider?.model ?? "",
    baseUrl: provider?.baseUrl ?? "",
    language: provider?.language ?? "",
  };
}

export function openaiToProviderPart(values: OpenAIFormValues): OpenAIProviderPart {
  return {
    apiKey: values.apiKey.trim(),
    model: values.model.trim() || undefined,
    baseUrl: values.baseUrl.trim().replace(/\/+$/, "") || undefined,
    language: values.language.trim() || undefined,
  };
}

// ── IFlytek（讯飞） ─────────────────────────────────────────────────────

export const iflytekSchema = z.object({
  apiKey: z.string().trim().min(1, "settings.speechToText.validation.enterApiKey"),
  appId: z.string().trim().min(1, "settings.speechToText.validation.enterAppId"),
  apiSecret: z.string().trim().min(1, "settings.speechToText.validation.enterApiSecret"),
  baseUrl: z.string(),
  language: z.string(),
});
export type IFlytekFormValues = z.input<typeof iflytekSchema>;
export type IFlytekProviderPart = Pick<
  SpeechToTextProviderInfo,
  "apiKey" | "appId" | "apiSecret" | "baseUrl" | "language"
>;

export function iflytekDefaultValues(): IFlytekFormValues {
  return { apiKey: "", appId: "", apiSecret: "", baseUrl: "", language: "" };
}

export function iflytekFromProvider(provider: SpeechToTextProviderInfo | null): IFlytekFormValues {
  return {
    apiKey: provider?.apiKey ?? "",
    appId: provider?.appId ?? "",
    apiSecret: provider?.apiSecret ?? "",
    baseUrl: provider?.baseUrl ?? "",
    language: provider?.language ?? "",
  };
}

export function iflytekToProviderPart(values: IFlytekFormValues): IFlytekProviderPart {
  return {
    apiKey: values.apiKey.trim(),
    appId: values.appId.trim(),
    apiSecret: values.apiSecret.trim(),
    baseUrl: values.baseUrl.trim().replace(/\/+$/, "") || undefined,
    language: values.language.trim() || undefined,
  };
}
