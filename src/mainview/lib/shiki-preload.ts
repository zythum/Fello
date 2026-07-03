import { preloadHighlighter } from "@pierre/diffs";

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
  themes: ["github-light", "github-dark"],
  langs: [
    "text",
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
  ],
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
