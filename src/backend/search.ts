import { join, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";
import { ripgrep } from "ripgrep";
import type { SocketServer } from "./socket-server";
import {
  searchRequestSchema,
  searchRespondSchema,
  rgRequestSchema,
  rgRespondSchema,
  fileOutlineRequestSchema,
  fileOutlineRespondSchema,
} from "../shared/zod/mcp-search-schema";
import { extractOutline, outlineToSummary } from "./file-outline";

// ── Path Normalization ───────────────────────────────────────────────

/**
 * Normalize a search path to an absolute filesystem path.
 *
 * Handles four input formats:
 * 1. `file://` URIs → converted via fileURLToPath
 * 2. POSIX / Windows absolute paths → used as-is
 * 3. Relative paths → resolved against projectDir (or optional cwd override)
 */
function normalizePath(inputPath: string, projectDir: string, cwd?: string): string {
  // file:// URI
  if (inputPath.startsWith("file://")) {
    return fileURLToPath(inputPath);
  }
  // Absolute path (POSIX or Windows)
  if (isAbsolute(inputPath)) {
    return inputPath;
  }
  // Relative path — resolve against cwd override or project dir
  const base = cwd ? resolve(projectDir, cwd) : projectDir;
  return resolve(base, inputPath);
}

// ── Effective CWD ────────────────────────────────────────────────────

function effectiveCwd(projectDir: string, cwd?: string): string {
  return cwd ? resolve(projectDir, cwd) : projectDir;
}

// ── Search Handler ───────────────────────────────────────────────────

export interface SearchOptions {
  projectDir: string;
  pattern: string;
  path: string;
  ignoreCase?: boolean;
  fixedStrings?: boolean;
  type?: string;
  glob?: string;
  context?: number;
  maxResults?: number;
  listFiles?: boolean;
  invertMatch?: boolean;
  wordMatch?: boolean;
  cwd?: string;
}

export async function search(options: SearchOptions): Promise<{ output: string; code: number }> {
  const args: string[] = [];

  if (options.ignoreCase) args.push("-i");
  if (options.fixedStrings) args.push("-F");
  if (options.type) args.push("-t", options.type);
  if (options.glob) args.push("-g", options.glob);
  if (options.context !== undefined) args.push("-C", String(options.context));
  if (options.maxResults !== undefined) args.push("-m", String(options.maxResults));
  if (options.listFiles) args.push("-l");
  if (options.invertMatch) args.push("-v");
  if (options.wordMatch) args.push("-w");

  args.push("--heading");
  args.push("--line-number");
  args.push(options.pattern);
  args.push(normalizePath(options.path, options.projectDir, options.cwd));

  const { code, stdout } = await ripgrep(args, {
    buffer: true,
    preopens: { ".": effectiveCwd(options.projectDir, options.cwd) },
  });

  return { output: stdout || "", code };
}

// ── Rg Handler ───────────────────────────────────────────────────────

export interface RgOptions {
  projectDir: string;
  args: string[];
  cwd?: string;
}

export async function rg(
  options: RgOptions,
): Promise<{ output: string; code: number; stderr?: string }> {
  const base = effectiveCwd(options.projectDir, options.cwd);

  const { code, stdout, stderr } = await ripgrep(options.args, {
    buffer: true,
    // Map "." to the effective working directory. The ripgrep WASM
    // resolves relative paths against WASI preopens. Absolute paths
    // in args are auto-added as preopens by the ripgrep package.
    preopens: { ".": base },
  });

  return {
    output: stdout || "",
    code,
    stderr: stderr || undefined,
  };
}

// ── FileOutline Handler ────────────────────────────────────────────

export interface FileOutlineOptions {
  projectDir: string;
  path: string;
  cwd?: string;
}

export async function fileOutline(options: FileOutlineOptions): Promise<{ outline: string }> {
  const filePath = normalizePath(options.path, options.projectDir, options.cwd);

  const content = await readFile(filePath, "utf8");

  const outline = await extractOutline(filePath, content);
  const summary = outlineToSummary(outline);
  return { outline: summary };
}

// ── Route Registration ──────────────────────────────────────────────

export function registerSearchRoute(server: SocketServer, projectDir: string) {
  server.registry("search/search", async (payload: unknown) => {
    const params = searchRequestSchema.parse(payload);
    const result = await search({ projectDir, ...params });
    return searchRespondSchema.parse(result);
  });

  server.registry("search/rg", async (payload: unknown) => {
    const params = rgRequestSchema.parse(payload);
    const result = await rg({ projectDir, ...params });
    return rgRespondSchema.parse(result);
  });

  server.registry("search/file_outline", async (payload: unknown) => {
    const params = fileOutlineRequestSchema.parse(payload);
    const result = await fileOutline({ projectDir, ...params });
    return fileOutlineRespondSchema.parse(result);
  });
}

// ── MCP Server Config ───────────────────────────────────────────────

export function buildSearchMcpServer(options: { projectDir: string; socketPath: string }): {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
} {
  return {
    name: "search",
    command: process.execPath,
    args: [
      join(process.scriptsPath, "mcp-search/server.mjs"),
      "--project-dir",
      options.projectDir,
      "--socket-path",
      options.socketPath,
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };
}
