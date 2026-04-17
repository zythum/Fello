import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

export function getShikiHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [
        "javascript",
        "typescript",
        "jsx",
        "tsx",
        "json",
        "css",
        "html",
        "markdown",
        "python",
        "go",
        "rust",
        "diff",
        "dotenv",
        "sh",
        "bash",
        "dockerfile",
      ],
    });
  }
  return highlighterPromise;
}

export function getShikiLanguageFromFilename(filename?: string) {
  const normalized = filename?.split("/").pop() ?? filename;
  const ext = normalized?.split(".").pop()?.toLowerCase() || "text";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    jsonc: "json",
    json5: "json",
    jsonl: "json",
    geojson: "json",
    har: "json",
    avsc: "json",
    ipynb: "json",
    prettierrc: "json",
    eslintrc: "json",
    babelrc: "json",
    stylelintrc: "json",
    lintstagedrc: "json",
    md: "markdown",
    css: "css",
    html: "html",
    rs: "rust",
    py: "python",
    go: "go",
    env: "dotenv",
    gitignore: "text",
    dockerignore: "text",
    sh: "sh",
    bash: "bash",
    dockerfile: "dockerfile",
  };
  return langMap[ext] || ext;
}

export function getShikiTheme(resolvedTheme?: string) {
  return resolvedTheme === "dark" ? "github-dark" : "github-light";
}
