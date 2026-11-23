import { homedir } from "os";
import { isAbsolute, join, resolve, sep } from "path";

/**
 * Paths that belong to the assistant runtime itself. The filesystem tools may read them,
 * but never write, move or use them as a worker workspace: corrupting session state or
 * history, reminders, memory or a diary would break the assistant.
 */
const PROTECTED_WRITE_PREFIXES = [
  // All per-assistant runtime data (config.json, session/, chat/, memory/, workers/, reminders/).
  join(homedir(), ".fello", "assistants"),
  // Legacy single-assistant directories, kept protected until the old data is removed.
  join(homedir(), ".fello", "assistant", "agent"),
  join(homedir(), ".fello", "assistant", "session"),
  join(homedir(), ".fello", "assistant", "diary"),
];

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
 */
export function assertWritablePath(path: string): void {
  const blocked = PROTECTED_WRITE_PREFIXES.find((prefix) => isInside(path, prefix));
  if (blocked) {
    throw new Error(
      `Refusing to modify ${path}: it belongs to the assistant runtime (${blocked}).`,
    );
  }
}

export function isProtectedWritePath(path: string): boolean {
  return PROTECTED_WRITE_PREFIXES.some((prefix) => isInside(path, prefix));
}

/**
 * Deletes are limited to the assistant workspace. On a headless server the deletion is
 * permanent, so anything outside the workspace (or the workspace root itself) must be left
 * to the user instead of being removed by the assistant.
 */
export function assertDeletablePath(path: string, workspace: string): void {
  const root = resolve(workspace);
  if (path === root) throw new Error(`Refusing to delete the workspace root: ${path}`);
  if (!isInside(path, root))
    throw new Error(
      `Refusing to delete ${path}: only paths inside the assistant workspace (${root}) can be deleted. Ask the user to delete it.`,
    );
  assertWritablePath(path);
}
