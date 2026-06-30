import { join, isAbsolute, resolve, relative } from "path";
import { fileURLToPath } from "url";
import { fork } from "child_process";
import type {
  RipgrepWorkerRequest,
  RipgrepWorkerResponse,
} from "../../shared/zod/worker-ripgrep-schema";

// ── Child Process Execution ──────────────────────────────────────────

function ripgrepInChild(
  args: string[],
  cwd: string,
  timeout = 30000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = fork(join(process.scriptsPath, "worker-ripgrep/worker.mjs"), [], { cwd });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ripgrep timed out (${timeout}ms)`));
    }, timeout);
    child.on("message", (msg: RipgrepWorkerResponse) => {
      clearTimeout(timer);
      if (msg.type === "error") reject(new Error(msg.error));
      else resolve({ code: msg.code, stdout: msg.stdout, stderr: msg.stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code && code !== 0) reject(new Error(`ripgrep worker exit ${code}`));
    });
    const request: RipgrepWorkerRequest = { args, cwd };
    child.send(request);
  });
}

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

// ── Search Handler ───────────────────────────────────────────────────

export interface SearchOptions {
  projectDir: string;
  pattern: string;
  path: string;
  ignoreCase?: boolean;
  regex?: boolean;
  type?: string;
  glob?: string;
  context?: number;
  maxResults?: number;
  listFiles?: boolean;
  invertMatch?: boolean;
  wordMatch?: boolean;
  timeout?: number;
}

export async function search(options: SearchOptions): Promise<{ output: string; code: number }> {
  const args: string[] = [];
  args.push("--heading");
  args.push("--line-number");

  if (options.ignoreCase) args.push("-i");
  if (!options.regex) args.push("-F");
  if (options.type) args.push("-t", options.type);
  if (options.glob) args.push("-g", options.glob);
  if (options.context !== undefined) args.push("-C", String(options.context));
  if (options.maxResults !== undefined) args.push("-m", String(options.maxResults));
  if (options.listFiles) args.push("-l");
  if (options.invertMatch) args.push("-v");
  if (options.wordMatch) args.push("-w");

  args.push(options.pattern);

  const filename = normalizePath(options.path, options.projectDir);
  const relativeFilename = relative(options.projectDir, filename);
  if (relativeFilename) {
    args.push((relativeFilename.startsWith("..") ? filename : relativeFilename) || ".");
  }
  const { code, stdout } = await ripgrepInChild(args, options.projectDir, options.timeout);
  return { output: stdout || "", code };
}

// ── Rg Handler ───────────────────────────────────────────────────────

export interface RgOptions {
  projectDir: string;
  args: string[];
  timeout?: number;
}

export async function rg(
  options: RgOptions,
): Promise<{ output: string; code: number; stderr?: string }> {
  const { code, stdout, stderr } = await ripgrepInChild(
    options.args,
    options.projectDir,
    options.timeout,
  );

  return {
    output: stdout || "",
    code,
    stderr: stderr || undefined,
  };
}
