/**
 * Virtual project ids for personal-assistant workspaces.
 *
 * Each assistant owns one workspace (`~/.fello/workspaces/__assistant__<id>__`) which is
 * exposed as a virtual project so file routes / the file panel can address it without
 * adding it to the sidebar project list.
 */
export const ASSISTANT_PROJECT_PREFIX = "__assistant__";

/** `__assistant__<id>__` — the id is embedded verbatim. */
export function assistantProjectId(assistantId: string): string {
  return `${ASSISTANT_PROJECT_PREFIX}${assistantId}__`;
}

/** Extracts the assistant id from a virtual project id, or null for real projects. */
export function parseAssistantProjectId(projectId: string): string | null {
  if (!projectId.startsWith(ASSISTANT_PROJECT_PREFIX)) return null;
  if (!projectId.endsWith("__")) return null;
  const id = projectId.slice(ASSISTANT_PROJECT_PREFIX.length, -2);
  return id || null;
}

/** Workspace directory name (same as the virtual project id). */
export function assistantWorkspaceName(assistantId: string): string {
  return assistantProjectId(assistantId);
}
