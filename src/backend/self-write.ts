/**
 * 应用自身发起的文件写入记录。
 *
 * 编辑器等场景在保存文件后，文件 watcher 会照常产生 fs-changed 事件；
 * 为了让前端能区分「应用自写」与「外部修改」，写入方在写完后记录文件的
 * mtime+size，watcher 在派发事件时用当前 stat 匹配这些记录，命中者标记为
 * selfChanges。相比前端按时间窗口猜测，stat 匹配是确定性的。
 */
import type { Stats } from "fs";

const TTL_MS = 5000;

type SelfWriteRecord = { mtimeMs: number; size: number; at: number };

const records = new Map<string, SelfWriteRecord[]>();

function keyOf(projectId: string, relativePath: string): string {
  return `${projectId}\0${relativePath}`;
}

function prune() {
  const now = Date.now();
  for (const [k, list] of records) {
    const alive = list.filter((r) => now - r.at <= TTL_MS);
    if (alive.length > 0) records.set(k, alive);
    else records.delete(k);
  }
}

/** 记录一次应用自身写入（写完后调用，stat 为写入后文件状态） */
export function recordSelfWrite(
  projectId: string,
  relativePath: string,
  stat: Pick<Stats, "mtimeMs" | "size">,
): void {
  prune();
  const k = keyOf(projectId, relativePath);
  const list = records.get(k) ?? [];
  list.push({ mtimeMs: stat.mtimeMs, size: stat.size, at: Date.now() });
  records.set(k, list);
}

/**
 * 判断指定路径的当前状态是否命中「应用自写」记录。
 * stat 为 null（文件已不存在）时直接返回 false。
 */
export function isSelfWrite(
  projectId: string,
  relativePath: string,
  stat: Pick<Stats, "mtimeMs" | "size"> | null,
): boolean {
  const k = keyOf(projectId, relativePath);
  const list = records.get(k);
  if (!list || !stat) return false;
  const now = Date.now();
  const alive = list.filter((r) => now - r.at <= TTL_MS);
  if (alive.length > 0) records.set(k, alive);
  else records.delete(k);
  return alive.some((r) => r.mtimeMs === stat.mtimeMs && r.size === stat.size);
}
