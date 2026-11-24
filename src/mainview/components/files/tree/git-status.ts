/** 目录行在 gitStatusMap 里的占位值（有变更的子项折叠在目录下）。 */
export const GIT_FOLDER_STATUS = {
  text: "•",
  color: "text-amber-500/90",
} as const;

/** git 摘要 / 行内标记的展示顺序与配色。 */
export const GIT_SUMMARY_BADGES = [
  { key: "A", color: "text-emerald-500" },
  { key: "U", color: "text-cyan-500" },
  { key: "M", color: "text-amber-500" },
  { key: "R", color: "text-orange-500" },
  { key: "C", color: "text-yellow-500" },
  { key: "D", color: "text-red-500" },
] as const;

export type GitSummaryKey = (typeof GIT_SUMMARY_BADGES)[number]["key"];

function badgeOf(key: GitSummaryKey): { text: string; color: string } {
  const badge = GIT_SUMMARY_BADGES.find((item) => item.key === key);
  return { text: key, color: badge?.color ?? "" };
}

/**
 * 把 git porcelain 状态串解析成行内标记（字符 + 颜色）。
 * 判定顺序与原实现一致：?? → A → R → C → M → D，其余原样展示。
 */
export function resolveGitRowBadge(status: string): { text: string; color: string } {
  if (status === GIT_FOLDER_STATUS.text) return GIT_FOLDER_STATUS;
  if (status.includes("??")) return badgeOf("U");
  for (const key of ["A", "R", "C", "M", "D"] as const) {
    if (status.includes(key)) return badgeOf(key);
  }
  return { text: status.trim(), color: "text-muted-foreground/90" };
}
