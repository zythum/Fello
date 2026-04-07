import { relative, resolve, isAbsolute } from "path";
import { statSync, Stats } from "fs";
import { IGNORE_REGEX } from "./constants";

/**
 * Checks if a given path should be ignored based on the global ignore rules.
 * @param fullPath The absolute path of the file or directory to check.
 * @param cwd The absolute path of the project root directory.
 * @param stats Optional fs stats; when provided, avoids an extra stat call.
 * @returns true if the path matches the ignore regex, false otherwise.
 */
export function isIgnorePath(
  fullPath: string,
  cwd: string,
  stats?: Stats | null,
): boolean {
  if (fullPath === cwd) return false;

  const isDir =
    stats?.isDirectory() ??
    (() => {
      try {
        return statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    })();

  // Append a trailing slash if it's a directory to accurately match hidden folders (e.g. `.git/`)
  // without accidentally matching hidden files (e.g. `.gitignore`).
  const relPath = relative(cwd, fullPath) + (isDir ? "/" : "");
  return IGNORE_REGEX.test(relPath);
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
