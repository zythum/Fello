/**
 * 语音方向共用的少量工具：识别（`asr-config.ts`）与合成（`tts-config.ts`）的
 * Provider → 库配置映射结构对称，凭证读取与报错口径也应一致，集中在这里避免两份实现漂移。
 */

/** 去掉首尾空白；空串视为「未配置」。 */
export function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** 必填字段读取：缺失时以「{direction}配置缺少 {name}。」抛错。 */
export function requireField(value: string | undefined, name: string, direction: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${direction}配置缺少 ${name}。`);
  return result;
}

/** 错误对象 → 可展示文案。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
