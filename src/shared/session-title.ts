/** Longest title we keep; a longer one would be truncated by the sidebar / header anyway. */
export const MAX_SESSION_TITLE_LENGTH = 80;

/**
 * Normalize a session title coming from the user or from an agent.
 *
 * Titles end up in the sidebar row and the chat header, which are single-line and narrow, so
 * newlines and runs of whitespace are flattened and long titles are truncated. A blank result
 * means "no title" — callers keep the previous title or fall back to the auto one.
 */
export function normalizeSessionTitle(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_SESSION_TITLE_LENGTH) return flat;
  return `${flat.slice(0, MAX_SESSION_TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * Title to show for a session: a title the user set by hand wins over the agent / auto one.
 *
 * `SessionInfo` keeps the two slots separate (the agent may keep rewriting `title`, the user
 * override lives in `userTitle`), so every display site must resolve through here instead of
 * reading `session.title` directly — otherwise a user rename would only show up in the places
 * that remembered to special-case it.
 */
export function resolveSessionTitle(session: { title: string; userTitle: string | null }): string {
  return session.userTitle || session.title;
}
