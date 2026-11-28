import { realpathSync } from "fs";
import { relative, resolve, isAbsolute } from "path";

/** `realpath` 失败（目标不存在等）时退回原值。 */
export function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * 跨平台路径相等比较。
 *
 * - Windows：大小写不敏感，且 `realpath` 能消掉 8.3 短名 / junction 差异；
 * - POSIX：按原样比较，但在两边都存在时先 `realpath`，避免符号链接造成的假不等。
 *
 * 目标可能尚不存在，此时退化为 `resolve` 后的字符串比较。
 */
export function samePath(a: string, b: string): boolean {
  const ra = realpathOrSelf(resolve(a));
  const rb = realpathOrSelf(resolve(b));
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * Converts a path to a POSIX style path (using forward slashes).
 * Useful for normalizing paths before sending them to the frontend.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Resolves a safe absolute path from a project root and a relative path.
 * Prevents path traversal attacks (e.g. using `../` to access files outside the project).
 * @param cwd The absolute path of the project root directory.
 * @param relativePath The relative path from the project root.
 * @returns The resolved absolute path, or throws an error if the path is outside the project root.
 */
export function resolveSafePath(cwd: string, relativePath: string): string {
  const safeCwd = resolve(cwd);
  const fullPath = resolve(safeCwd, relativePath || "");

  // Use path.relative to accurately determine if the resolved path escapes the base directory
  const rel = relative(safeCwd, fullPath);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path traversal detected: ${relativePath} is outside of project root ${cwd}`);
  }

  return fullPath;
}

export function extractErrorMessage(error: unknown): string {
  if (typeof error === "boolean" || typeof error === "undefined" || error === null) {
    return "Errored";
  }

  if (typeof error === "string" || typeof error === "number") {
    return String(error);
  }

  if (typeof error === "object" && error) {
    const messages = [];
    if ("error" in error && typeof error.error !== "object") {
      messages.push(`[${error.error}]`);
    }
    if ("code" in error && typeof error.code !== "object") {
      messages.push(`[${error.code}]`);
    }
    if ("message" in error) {
      messages.push(error.message);
    }
    if ("data" in error && error.data) {
      if (typeof error.data === "string") {
        messages.push(error.data);
      } else if (typeof error.data === "object") {
        for (const name in error.data) {
          const value = (error.data as any)[name];
          if (typeof value === "string" || typeof value === "number") {
            messages.push(`${name}:${value}`);
          }
        }
      }
    }
    if (messages.length) {
      return messages.join(" ");
    }
  }
  try {
    return JSON.stringify(error);
  } catch (err) {
    console.warn("[Utils] ExtractErrorMessage Error.", err);
    return "";
  }
}
