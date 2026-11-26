import { extractErrorMessage } from "@/lib/utils";

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  return extractErrorMessage(error) || fallbackMessage;
}

/** 相对时间显示：分钟/小时/天，超过 30 天回退到本地化日期 */
export function formatRelativeTime(timestamp: number, language: string): string {
  const diff = Date.now() - timestamp;
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return rtf.format(0, "minute");
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, "day");
  return new Date(timestamp).toLocaleDateString(language);
}
