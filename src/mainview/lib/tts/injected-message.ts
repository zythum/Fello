import { parseLeadingTag } from "../../../shared/message-tag";

/** 应用注入的事件消息类型：它们以 user_message 到达，但不是用户说的话。 */
const INJECTED_TAG_TYPES = new Set(["Reminder", "Worker"]);

/**
 * 从一条注入消息里取出「可朗读的正文」。
 *
 * - 标签本身（`[Reminder id="..." retry="N"]` / `[Worker id="..." event="..."]`）不读；
 * - 普通用户消息没有标签 → 返回 null，保持「不朗读用户自己说的话」；
 * - 代码围栏不在这里处理：`tts-text` 的分句器会整块丢弃。
 *
 * Worker 通知的正文由 `worker/manager.ts` 固定拼装（只有两种）：
 * - finished / failed：`<name>` / `Error: ...` 或 `Stop reason: ...` / `<worker 输出>`
 * - permission：`<name> requests permission` / `Tool: ...` / [JSON input] / `Options: ...` / 回复指引
 *
 * 因此这里按结构取：finished / failed 只丢掉 `Stop reason` 这行协议元数据（`Error:` 是
 * 真实失败原因，要读）；permission 只保留头部和 `Tool:`，JSON input / options / 回复
 * 指引都是给模型看的。worker 输出本身原样交给分句器，不做逐行猜测。
 */
export function speakableInjectedText(text: string): string | null {
  const tag = parseLeadingTag(text);
  if (!tag || !INJECTED_TAG_TYPES.has(tag.type)) return null;
  if (tag.type === "Reminder") return tag.body.trim() || null;

  const lines = tag.body.split("\n").map((line) => line.trim());
  const head = lines[0] ?? "";
  const content =
    tag.attributes.event === "permission"
      ? lines.filter((line) => line.startsWith("Tool:"))
      : lines.slice(1).filter((line) => !line.startsWith("Stop reason:"));
  const spoken = [head, ...content].filter(Boolean).join("\n");
  return spoken || null;
}
