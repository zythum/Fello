import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, parse, resolve, sep } from "path";

import type { DataRootProblem, DataRootSetResult, DataRootSource } from "../../shared/schema";
import { realpathOrSelf, samePath } from "../utils";
import { FELLO_RC_PATH, readFelloRc, writeFelloRc } from "./fello-rc";

/** Historical default. Kept so existing installs never move on upgrade. */
export const DEFAULT_DATA_ROOT = join(homedir(), ".fello");

export type DataRootProblemReason = "not-absolute" | "missing" | "not-directory" | "config";

export class DataRootError extends Error {
  constructor(
    message: string,
    readonly reason: DataRootProblemReason,
  ) {
    super(message);
    this.name = "DataRootError";
  }
}

export interface DataRootInfo {
  /**
   * Directory the app should use. When `problem` is set this is the default
   * directory: it is a display fallback only, never what the app boots with.
   */
  dir: string;
  source: DataRootSource;
  /** Raw configured value; `null` when using the default. */
  configured: string | null;
  /** Human-readable reason the configured directory is unusable. */
  problem: string | null;
  problemReason: DataRootProblemReason | null;
}

export interface DataRootOptions {
  /** Overridable for tests; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Overridable for tests; defaults to `~/.fellorc`. */
  rcPath?: string;
  /** Overridable for tests; defaults to `~/.fello`. */
  defaultRoot?: string;
}

/**
 * Per-process override used by the startup recovery dialog: when the
 * configured root is unusable the user may choose to boot with the default one
 * for this run only.
 *
 * Deliberately not `process.env`: changing the env var would leak into every
 * child process (agents, MCP servers) and change what they resolve.
 */
let processOverride: string | null = null;

export function overrideDataRootForProcess(dir: string | null): void {
  processOverride = dir;
}

function describe(
  raw: string,
  source: DataRootSource,
  origin: string,
  defaultRoot: string,
  /** Base for relative values; `null` means relative paths are rejected. */
  relativeBase: string | null,
): DataRootInfo {
  const value = raw.trim();

  // `~` 不做展开：`~/fello` 就是一个首段叫 `~` 的相对路径，最终落到
  // `<`.fellorc` 所在目录>/~/fello`。写错了会在启动时报"目录不存在"，
  // 不需要单独的语法错误。
  const dir = isAbsolute(value)
    ? resolve(value)
    : relativeBase !== null
      ? resolve(relativeBase, value)
      : null;

  if (dir === null) {
    return {
      dir: defaultRoot,
      source,
      configured: raw,
      problem: `${origin} must be an absolute path, got "${raw}".`,
      problemReason: "not-absolute",
    };
  }

  if (!existsSync(dir)) {
    // The default root is allowed to be absent: `prepare.ts` creates it. The
    // exemption also covers an explicit `FELLO_DATA_ROOT=~/.fello`.
    if (samePath(dir, defaultRoot)) {
      return { dir, source, configured: raw, problem: null, problemReason: null };
    }
    return {
      dir,
      source,
      configured: raw,
      problem: `${origin} points to ${dir}, which does not exist.`,
      problemReason: "missing",
    };
  }
  if (!statSync(dir).isDirectory()) {
    return {
      dir,
      source,
      configured: raw,
      problem: `${dir} exists but is not a directory.`,
      problemReason: "not-directory",
    };
  }
  return { dir, source, configured: raw, problem: null, problemReason: null };
}

/**
 * Resolves the data root without throwing. Precedence:
 * process override > `FELLO_DATA_ROOT` > `~/.fellorc` > `~/.fello`.
 *
 * Note: when `problem` is set, `dir` is NOT usable — callers must not boot with
 * it. `resolveDataRoot` is the fail-closed variant.
 */
export function getDataRootInfo(options: DataRootOptions = {}): DataRootInfo {
  const env = options.env ?? process.env;
  const rcPath = options.rcPath ?? FELLO_RC_PATH;
  const defaultRoot = options.defaultRoot ?? DEFAULT_DATA_ROOT;

  if (processOverride) {
    return {
      dir: resolve(processOverride),
      source: "default",
      configured: null,
      problem: null,
      problemReason: null,
    };
  }

  // 环境变量没有「所在目录」这一概念：相对路径在 GUI 启动下会解析到 `/`，
  // 行为不可预期，所以只接受绝对路径。
  const fromEnv = env.FELLO_DATA_ROOT?.trim() ?? "";
  if (fromEnv) return describe(fromEnv, "env", "FELLO_DATA_ROOT", defaultRoot, null);

  let configured: string | null;
  try {
    configured = readFelloRc(rcPath).dataRoot;
  } catch (error) {
    return {
      dir: defaultRoot,
      source: "rc",
      configured: null,
      problem: error instanceof Error ? error.message : String(error),
      problemReason: "config",
    };
  }

  // 配置文件里的相对路径相对于 `.fellorc` 所在目录（通常是 home），
  // 与 git 的 `include.path` 同一套直觉。
  if (configured) return describe(configured, "rc", rcPath, defaultRoot, dirname(rcPath));
  return {
    dir: defaultRoot,
    source: "default",
    configured: null,
    problem: null,
    problemReason: null,
  };
}

/**
 * Fail-closed resolution used at module load. A configured directory is never
 * created here: an unmounted volume must surface as an error instead of
 * silently becoming a fresh empty data root on the boot disk.
 */
export function resolveDataRoot(options: DataRootOptions = {}): string {
  const info = getDataRootInfo(options);
  if (info.problem) {
    throw new DataRootError(info.problem, info.problemReason ?? "config");
  }
  if (existsSync(info.dir) && !statSync(info.dir).isDirectory()) {
    throw new DataRootError(`${info.dir} exists but is not a directory.`, "not-directory");
  }
  return info.dir;
}

// ── 切换数据根（校验 + 写入 `~/.fellorc`） ──────────────────────────

/** 系统噪声文件：目录里只有这些时仍然算「空」。 */
const IGNORED_ENTRIES = new Set([
  ".DS_Store",
  "Icon\r",
  ".localized",
  "Thumbs.db",
  "desktop.ini",
]);

/** 出现任意一项，就认为它已经是一个 Fello 数据根（允许接管已有数据）。 */
const FELLO_ROOT_MARKERS = [
  "settings.json",
  "projects",
  "api-agents",
  "assistants",
  "workspaces",
  "automations",
  "ilink",
  "skills",
];

function isFelloDataRoot(dir: string): boolean {
  return FELLO_ROOT_MARKERS.some((name) => existsSync(join(dir, name)));
}

function isInside(path: string, parent: string): boolean {
  // Windows 路径大小写不敏感；根目录本身以分隔符结尾，不能直接拼 `sep`。
  const fold = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  const p = fold(path);
  const q = fold(parent);
  const base = q.endsWith(sep) ? q : q + sep;
  return p === q || p.startsWith(base);
}

function probeWritable(dir: string): boolean {
  const probe = join(dir, `.fello-write-test-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(probe, "ok", { mode: 0o600 });
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * 校验目标目录是否可以成为数据根。返回 `null` 表示通过。
 *
 * 规则（宁可拒绝，不替用户猜）：
 * - 绝对路径、存在、是目录、可写；
 * - 不能是当前数据根，也不能与当前数据根互为祖先/后代；
 * - 空目录可以；已有 Fello 数据根可以（接管已有数据）；
 * - 其它非空目录拒绝——Fello 会在数据根里创建 settings.json / projects 等文件。
 */
function checkDataDirectory(target: string, current: string): DataRootProblem | null {
  const trimmed = target.trim();
  if (!trimmed) return { code: "empty" };
  if (!isAbsolute(trimmed)) return { code: "relative" };

  const dir = resolve(trimmed);
  if (!existsSync(dir)) return { code: "missing", path: dir };

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(dir);
  } catch {
    return { code: "unreadable", path: dir };
  }
  if (!stat.isDirectory()) return { code: "not-directory", path: dir };

  // 盘符根 / 文件系统根，以及用户主目录本身：都不适合当数据根（会把文件散落一地）。
  if (samePath(dir, parse(dir).root)) return { code: "filesystem-root", path: dir };
  if (samePath(dir, homedir())) return { code: "home-directory", path: dir };

  const real = realpathOrSelf(dir);
  const currentReal = realpathOrSelf(current);
  if (samePath(real, currentReal)) return { code: "same", path: real };
  if (isInside(real, currentReal)) return { code: "inside-current", path: real };
  if (isInside(currentReal, real)) return { code: "contains-current", path: real };

  // access(W_OK) 在 macOS TCC 下会骗人，直接做一次真实的创建/删除。
  if (!probeWritable(dir)) return { code: "not-writable", path: dir };

  if (isFelloDataRoot(dir)) return null;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { code: "unreadable", path: dir };
  }
  const meaningful = entries.filter((name) => !IGNORED_ENTRIES.has(name));
  if (meaningful.length > 0) return { code: "not-empty", path: dir };

  return null;
}

/**
 * 写入新的数据根（`null` = 还原为默认）。
 *
 * 只写 `~/.fellorc`，不移动、不删除任何数据；生效需要重启。
 */
export function setDataRoot(target: string | null, current: string): DataRootSetResult {
  // 环境变量优先于配置文件：此时写 .fellorc 不会生效，直接拒绝而不是假装成功。
  if (getDataRootInfo().source === "env") {
    return { ok: false, changed: false, path: target ?? "", problem: { code: "env-locked" } };
  }

  if (target === null) {
    const result = writeFelloRc({ dataRoot: null });
    return { ok: true, changed: result.changed, path: result.path };
  }

  const problem = checkDataDirectory(target, current);
  if (problem) return { ok: false, changed: false, path: target, problem };

  const result = writeFelloRc({ dataRoot: resolve(target.trim()) });
  return { ok: true, changed: result.changed, path: result.path };
}
