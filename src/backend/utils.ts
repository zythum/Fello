import { relative, resolve, isAbsolute } from "path";

const IGNORE_NAME_SET = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "vendor",
  "__pycache__",
]);

/**
 * Checks if a given path should be ignored based on the global ignore rules.
 * @param fullPath The absolute path of the file or directory to check.
 * @param cwd The absolute path of the project root directory.
 * @returns true if the path should be ignored, false otherwise.
 */
export function isIgnorePath(fullPath: string, cwd: string): boolean {
  if (fullPath === cwd) return false;
  const relPath = relative(cwd, fullPath);
  if (!relPath) return false;
  const segments = relPath.split(/[\\/]+/);
  for (let i = 0; i < segments.length; i++) {
    const name = segments[i];
    if (!name || name === ".") continue;
    if (IGNORE_NAME_SET.has(name)) return true;
  }
  return false;
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
