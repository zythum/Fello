import { preloadHighlighter } from "@pierre/diffs";

/** @pierre/diffs 与 Monaco 共用的 Shiki 主题，保证两处高亮配色一致。 */
export const SHIKI_THEMES = ["github-light", "github-dark"] as const;

/** @pierre/diffs 与 Monaco 共用、且带 grammar 的语言集合。 */
export const SHIKI_GRAMMAR_LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "css",
  "html",
  "json",
  "jsonc",
  "json5",
  "jsonl",
  "yaml",
  "markdown",
  "c",
  "cpp",
  "swift",
  "kotlin",
  "shellscript",
  "sql",
  "rust",
  "go",
  "dart",
  "java",
  "dotenv",
  "docker",
  "diff",
  "git-commit",
  "git-rebase",
] as const;

/**
 * @pierre/diffs 与 Monaco 共用的语言集合。
 * `text` 是 Shiki 的伪语言（无 grammar），但 Monaco 需要注册同名语言 id。
 */
export const SHIKI_LANGS = ["text", ...SHIKI_GRAMMAR_LANGS] as const;

/**
 * Pre-warm Shiki syntax highlighter as early as possible.
 * Shiki is lazily initialized on first use, which causes the diff/code view
 * to render empty or without highlighting on the first open.
 * Preloading ensures it's ready when needed.
 *
 * NOTE: We must NOT use `isHighlighterLoaded()` to determine readiness,
 * because it returns `true` as soon as the highlighter *instance* exists,
 * BEFORE all preloaded languages/themes have been fully resolved and
 * attached to the highlighter.  If we render a `<File>` during that window,
 * `@pierre/diffs`'s `FileRenderer` will see `areLanguagesAttached("c")`
 * as `false` and fall back to plain-text rendering (no syntax highlighting).
 * Only when `shikiPreloadPromise` settles are all languages/themes guaranteed
 * to be attached.  The `preloadSettled` flag below tracks that.
 */
export const shikiPreloadPromise = preloadHighlighter({
  themes: [...SHIKI_THEMES],
  langs: [...SHIKI_LANGS],
  preferredHighlighter: "shiki-js",
});

let _preloadSettled = false;
shikiPreloadPromise.finally(() => {
  _preloadSettled = true;
});

/**
 * Check if the full Shiki preload (highlighter instance + all languages/themes)
 * has completed.  Safe to use before rendering a `<File>` / `<FileDiff>`.
 */
export function isShikiReady(): boolean {
  return _preloadSettled;
}
