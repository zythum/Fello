import { homedir } from "os";
import { isAbsolute, join, resolve, sep } from "path";

/**
 * Directories that belong to the assistant runtime itself. Every per-assistant data
 * directory sits under `<felloDir>/assistants`; the legacy single-assistant directories
 * stay protected until the old data is removed.
 *
 * 数据根由调用方注入（宿主知道 FELLO_DIR），这样 `src/assistant` 不必反过来 import
 * `src/backend`；「哪些目录受保护」这条领域知识仍然留在本文件。
 */
export function assistantProtectedRoots(felloDir: string): readonly string[] {
  return [
    // All per-assistant runtime data (config.json, session/, chat/, memory/, workers/, reminders/).
    join(felloDir, "assistants"),
    // Legacy single-assistant directories, kept protected until the old data is removed.
    join(felloDir, "assistant", "agent"),
    join(felloDir, "assistant", "session"),
    join(felloDir, "assistant", "diary"),
  ];
}

/** Expands `~` and resolves relative input against the assistant workspace. */
export function resolveAssistantPath(input: string, workspace: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Path is empty.");
  const expanded =
    trimmed === "~"
      ? homedir()
      : trimmed.startsWith("~/")
        ? join(homedir(), trimmed.slice(2))
        : trimmed;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workspace, expanded);
}

function isInside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent + sep);
}

/**
 * Rejects writes into the assistant's own runtime directories. Reads are unrestricted:
 * the assistant may inspect anything, but its bookkeeping is system-owned.
 *
 * `protectedRoots` 刻意是必填参数：漏传会在编译期报错，不会静默退化成「不设防」。
 */
export function assertWritablePath(path: string, protectedRoots: readonly string[]): void {
  const blocked = protectedRoots.find((prefix) => isInside(path, prefix));
  if (blocked) {
    throw new Error(
      `Refusing to modify ${path}: it belongs to the assistant runtime (${blocked}).`,
    );
  }
}

export function isProtectedWritePath(path: string, protectedRoots: readonly string[]): boolean {
  return protectedRoots.some((prefix) => isInside(path, prefix));
}

/**
 * Deletes are limited to the assistant workspace. On a headless server the deletion is
 * permanent, so anything outside the workspace (or the workspace root itself) must be left
 * to the user instead of being removed by the assistant.
 */
export function assertDeletablePath(
  path: string,
  workspace: string,
  protectedRoots: readonly string[],
): void {
  const root = resolve(workspace);
  if (path === root) throw new Error(`Refusing to delete the workspace root: ${path}`);
  if (!isInside(path, root))
    throw new Error(
      `Refusing to delete ${path}: only paths inside the assistant workspace (${root}) can be deleted. Ask the user to delete it.`,
    );
  assertWritablePath(path, protectedRoots);
}
