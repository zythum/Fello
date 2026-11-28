import { randomBytes } from "crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { parseEnv } from "util";

/**
 * User-level Fello config file (`~/.fellorc`).
 *
 * It deliberately lives next to the *default* data root instead of inside it:
 * the file points at the data root, so moving the data must never move
 * the pointer. Its format is a safe subset of dotenv (see `renderFelloRc`).
 */
export const FELLO_RC_PATH = join(homedir(), ".fellorc");

const DATA_ROOT_KEY = "FELLO_DATA_ROOT";
const FILE_MODE = 0o600;
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

type FelloRcErrorReason =
  | "malformed"
  | "unreadable"
  | "unsupported-value"
  | "write-verify";

class FelloRcError extends Error {
  constructor(
    message: string,
    readonly reason: FelloRcErrorReason,
  ) {
    super(message);
    this.name = "FelloRcError";
  }
}

export interface FelloRcSettings {
  /** Configured data root; `null` when unset or explicitly empty. */
  dataRoot: string | null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isEmptySettings(settings: FelloRcSettings): boolean {
  return settings.dataRoot === null;
}

function readSetting(
  // `util.parseEnv` 的类型是 `Dict<string>`（值可能为 undefined），与 dotenv 略有差异。
  map: Record<string, string | undefined>,
  source: string,
  path: string,
  key: string,
): string | null {
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    const value = map[key] ?? "";
    // The dotenv format expands `\n` / `\r` inside double-quoted values only. A path must
    // never contain a line break, so this always means the value is corrupted.
    if (/[\r\n]/.test(value)) {
      throw new FelloRcError(
        `${key} in ${path} contains a line break. Do not wrap Windows paths in double quotes.`,
        "malformed",
      );
    }
    return value.trim() ? value : null;
  }

  // The parser silently skips lines it cannot parse. For our own key that must be
  // loud: a missing "=" would otherwise look like "not configured" and quietly
  // fall back to the default directory.
  const keyPattern = new RegExp(`^(?:export\\s+)?${key}\\b`);
  const mentioned = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(";"))
    .some((line) => keyPattern.test(line));

  if (mentioned) {
    throw new FelloRcError(
      `${key} is present in ${path} but could not be parsed. Expected \`${key}=/absolute/path\`.`,
      "malformed",
    );
  }
  return null;
}

function parseFelloRc(text: string, path: string = FELLO_RC_PATH): FelloRcSettings {
  const source = stripBom(text);
  // Node 内建的 .env 解析器（>= 20.12）：与 dotenv 语义一致，少一个依赖。
  // 它本身不处理 BOM，所以上面先 stripBom。
  const map = parseEnv(source);
  return { dataRoot: readSetting(map, source, path, DATA_ROOT_KEY) };
}

export function readFelloRc(path: string = FELLO_RC_PATH): FelloRcSettings {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { dataRoot: null };
    }
    throw new FelloRcError(
      `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "unreadable",
    );
  }
  return parseFelloRc(text, path);
}

/** Comment lines are rendered from user-provided values, so strip line breaks. */
function toComment(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function formatValue(key: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new FelloRcError(`${key} cannot contain a line break.`, "unsupported-value");
  }
  if (value.includes("'")) {
    throw new FelloRcError(
      `${key} cannot be written: the value contains a single quote (').`,
      "unsupported-value",
    );
  }
  // A bare value ends at `#`, and unquoted whitespace is trimmed. Single
  // quotes keep the value literal and are never unescaped.
  if (value.includes("#") || /^\s/.test(value) || /\s$/.test(value)) {
    return `'${value}'`;
  }
  return value;
}

interface RenderFelloRcOptions {
  /** Previously configured value, kept in a comment as a hint for switching back. */
  previousDataRoot?: string | null;
}

function renderFelloRc(
  settings: FelloRcSettings,
  options: RenderFelloRcOptions = {},
): string {
  const lines = [
    "# Fello configuration (dotenv format, not a shell script).",
    "# Managed by Fello: comments and formatting may be rewritten.",
    "#",
    "# - Restart Fello after changing a value",
    "# - The FELLO_DATA_ROOT environment variable takes precedence over this file",
    '# - An empty value means "use the default data root"',
    "# - Paths: absolute, or relative to this file's directory; ~ is not expanded",
    "# - No variable expansion: $VAR and %VAR% are kept literally",
  ];

  const previous = options.previousDataRoot?.trim();
  if (previous) {
    lines.push("#", `# previous data root: ${toComment(previous)}`);
  }

  const dataRoot = settings.dataRoot;
  lines.push(
    "",
    `${DATA_ROOT_KEY}=${dataRoot === null || dataRoot === "" ? "" : formatValue(DATA_ROOT_KEY, dataRoot)}`,
    "",
  );
  return lines.join("\n");
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt >= RENAME_RETRIES) {
        throw error;
      }
      // Windows: antivirus / another handle can hold the destination briefly.
      sleepSync(RENAME_RETRY_DELAY_MS);
    }
  }
}

function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch {
    // Directory fsync is not available on Windows; the rename is still atomic.
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function writeAtomic(target: string, content: string): void {
  const dir = dirname(target);
  const tmp = join(
    dir,
    `.${basename(target)}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  const expected = Buffer.from(content, "utf8");
  let fd: number | undefined;

  try {
    fd = openSync(tmp, "wx", FILE_MODE);
    writeSync(fd, content, null, "utf8");
    try {
      fchmodSync(fd, FILE_MODE);
    } catch {
      // Windows 的 chmod 只影响「只读」位，部分文件系统会直接拒绝；不致命。
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    // Verify before commit: never rename a file we could not read back exactly.
    if (!readFileSync(tmp).equals(expected)) {
      throw new FelloRcError(`Failed to verify ${target} before commit.`, "write-verify");
    }

    renameWithRetry(tmp, target);
    fsyncDir(dir);

    // Verify after commit as well; a mismatch here means the disk lied.
    if (!readFileSync(target).equals(expected)) {
      throw new FelloRcError(`Failed to verify ${target} after commit.`, "write-verify");
    }
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw error;
  }
}

/**
 * Writes through symlinks instead of replacing them, so a `.fellorc` linked to
 * a dotfiles repository keeps working.
 */
function resolveWriteTarget(filePath: string): string {
  let isLink: boolean;
  try {
    isLink = lstatSync(filePath).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return filePath;
    throw error;
  }
  if (!isLink) return filePath;

  try {
    return realpathSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Dangling symlink: write the file the link points at.
    return resolve(dirname(filePath), readlinkSync(filePath));
  }
}

interface WriteFelloRcResult {
  changed: boolean;
  path: string;
}

/**
 * Renders the whole file from a template (comments and unknown keys are
 * intentionally dropped) while preserving the settings themselves.
 *
 * - Only called for explicit user actions.
 * - A file is only created once a setting is actually non-default.
 * - Resetting keeps an existing file and writes an empty value.
 */
export function writeFelloRc(
  settings: FelloRcSettings,
  options: { path?: string } = {},
): WriteFelloRcResult {
  const requestPath = options.path ?? FELLO_RC_PATH;
  const target = resolveWriteTarget(requestPath);
  const exists = existsSync(target);
  // `readFelloRc` treats ENOENT as "unset" and wraps other IO errors, so a file
  // removed between `existsSync` and the read cannot crash the caller.
  const current = readFelloRc(target);

  // Effective value unchanged: leave the file (including manual edits) alone.
  if (current.dataRoot === settings.dataRoot) {
    return { changed: false, path: target };
  }

  // A reset with no file to keep must not create one.
  if (!exists && isEmptySettings(settings)) {
    return { changed: false, path: target };
  }

  const content = renderFelloRc(settings, { previousDataRoot: current.dataRoot });

  // The rendered file must read back to exactly what we intended.
  const roundTrip = parseFelloRc(content, target);
  if (roundTrip.dataRoot !== settings.dataRoot) {
    throw new FelloRcError(
      `Refusing to write ${target}: the rendered value did not round-trip.`,
      "write-verify",
    );
  }

  writeAtomic(target, content);
  return { changed: true, path: target };
}
