import { globby } from "globby";
import { isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";

// ── Path Normalization ───────────────────────────────────────────────

function normalizePath(inputPath: string, cwd?: string): string {
  if (inputPath.startsWith("file://")) {
    return fileURLToPath(inputPath);
  }
  if (isAbsolute(inputPath)) {
    return inputPath;
  }
  return resolve(cwd ?? process.cwd(), inputPath);
}

// ── Glob Handler ─────────────────────────────────────────────────────

export interface GlobOptions {
  projectDir: string;
  pattern: string;
  path?: string;
  limit?: number;
  maxDepth?: number;
  dot?: boolean;
  onlyFiles?: boolean;
  gitignore?: boolean;
}

export async function glob(
  options: GlobOptions,
): Promise<{ filePaths: string[]; totalFiles: number; truncated: boolean }> {
  const cwd = options.path ? normalizePath(options.path, options.projectDir) : options.projectDir;

  const entries = await globby(options.pattern, {
    cwd,
    dot: options.dot ?? false,
    onlyFiles: options.onlyFiles ?? false,
    markDirectories: true,
    gitignore: options.gitignore ?? true,
    deep: options.maxDepth,
  });

  entries.sort();

  const limit = options.limit ?? 500;
  const truncated = entries.length > limit;
  const filePaths = truncated ? entries.slice(0, limit) : entries;

  return {
    filePaths,
    totalFiles: entries.length,
    truncated,
  };
}
