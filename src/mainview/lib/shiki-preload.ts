import { preloadHighlighter, isHighlighterLoaded } from "@pierre/diffs";

/**
 * Pre-warm Shiki syntax highlighter as early as possible.
 * Shiki is lazily initialized on first use, which causes the diff/code view
 * to render empty or without highlighting on the first open.
 * Preloading ensures it's ready when needed.
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
    "yaml",
    "markdown",
    "shellscript",
    "bash",
    "sql",
    "rust",
    "go",
    "java",
    "dotenv",
    "dockerfile",
    "sh",
    "diff",
    // Common aliases used in markdown code fences — must be preloaded
    // separately because @pierre/diffs tracks attached languages by the
    // exact name passed to getSharedHighlighter, not by shiki's internal
    // canonical name.
    "js",
    "ts",
    "py",
    "yml",
    "md",
    "rb",
    "rs",
  ],
  preferredHighlighter: "shiki-js",
});

/** Check if Shiki has already finished loading. */
export function isShikiReady(): boolean {
  return isHighlighterLoaded();
}
