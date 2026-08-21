import type { ContextCategory } from "../../../../shared/schema";
import type { ChatMessage, ToolCallMessage } from "../../../lib/chat-message";

/** 将任意 ChatMessage 提取为可展示/计数的纯文本 */
export function chatMessageText(msg: ChatMessage): string {
  if (msg.role === "tool_call") {
    const t = msg as ToolCallMessage;
    return [t.title, t.rawInput ? JSON.stringify(t.rawInput) : "", t.content ? JSON.stringify(t.content) : ""]
      .filter(Boolean)
      .join("\n");
  }
  if (msg.role === "plan") {
    const plan = msg as { entries?: Array<{ title?: string }> };
    return (plan.entries ?? []).map((e) => e.title ?? "").join("\n");
  }
  const contents = (msg as { contents?: Array<{ type: string; text?: string }> }).contents;
  return (contents ?? [])
    .map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c)))
    .join("\n\n");
}

/** 六类组成的展示元数据（颜色 / i18n key / 排序） */
export const CONTEXT_CATEGORIES: Array<{
  key: ContextCategory;
  color: string;
  hex: string;
  i18nKey: string;
}> = [
  { key: "system", color: "bg-sky-500", hex: "#0ea5e9", i18nKey: "context.category.system" },
  { key: "tools", color: "bg-violet-500", hex: "#8b5cf6", i18nKey: "context.category.tools" },
  { key: "user", color: "bg-emerald-500", hex: "#10b981", i18nKey: "context.category.user" },
  { key: "assistant", color: "bg-amber-500", hex: "#f59e0b", i18nKey: "context.category.assistant" },
  { key: "toolResults", color: "bg-rose-500", hex: "#f43f5e", i18nKey: "context.category.toolResults" },
  { key: "injections", color: "bg-cyan-500", hex: "#06b6d4", i18nKey: "context.category.injections" },
];

export function categoryColor(key: ContextCategory): string {
  return CONTEXT_CATEGORIES.find((c) => c.key === key)?.color ?? "bg-muted";
}

/** 紧凑 token 格式化（12_345 → "12.3k"） */
export function formatTokens(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Δ 格式化（正/负带符号） */
export function formatDelta(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  if (n > 0) return `+${formatTokens(n)}`;
  return formatTokens(n);
}

/** 百分比（0-1 → 0-100 保留 2 位） */
export function toPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(100, ratio * 100));
}
