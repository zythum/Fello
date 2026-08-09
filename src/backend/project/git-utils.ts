import { execFile, spawn } from "child_process";
import { dirname, relative } from "path";
import { promisify } from "util";
import { toPosixPath } from "../utils";

const execFileAsync = promisify(execFile);

/**
 * Uses `git check-ignore` to determine which project-relative paths (POSIX) are
 * excluded by .gitignore rules (including nested .gitignore and `!` negation).
 * Runs git directly and falls back to an empty set when the directory is not a
 * git repository or git is unavailable, so callers can treat the result as
 * "nothing is ignored".
 */
export async function getGitIgnoredPaths(
  cwd: string,
  relPaths: string[],
): Promise<Set<string>> {
  if (relPaths.length === 0) return new Set<string>();
  // Feed all candidate paths at once via stdin; git itself resolves nested
  // .gitignore rules and `!` negations. Note: execFile's `input` option does
  // not actually write to the child's stdin, so spawn git and write the
  // NUL-separated list ourselves.
  return new Promise((resolve) => {
    const child = spawn("git", ["check-ignore", "-z", "--stdin"], {
      cwd,
      timeout: 3000,
      // spawn defaults windowsHide to false; without this, every readDir
      // would flash a console window on Windows.
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve(new Set<string>()));
    child.on("close", () => {
      const ignored = new Set<string>();
      for (const p of Buffer.concat(chunks).toString("utf8").split("\0")) {
        if (p) ignored.add(toPosixPath(p));
      }
      resolve(ignored);
    });
    // Write may fail if the process already exited (e.g. git missing);
    // ignore that and fall back to the empty set via the 'error' handler.
    try {
      child.stdin.write(relPaths.join("\0") + "\0");
      child.stdin.end();
    } catch {
      resolve(new Set<string>());
    }
  });
}

/**
 * Runs `git status --porcelain -b -z` inside `cwd` and returns the branch plus
 * a map of POSIX-relative paths to their two-letter status codes. Returns null
 * when `cwd` is not inside a git repository or git is unavailable.
 */
export async function getGitStatus(
  cwd: string,
): Promise<{ branch: string; files: Record<string, string> } | null> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "-b", "-z"], {
      cwd,
      timeout: 2000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = stdout.split("\0").filter(Boolean);
    if (lines.length === 0) return null;
    let branchLine = lines[0];
    let branch = "";
    if (branchLine.startsWith("## ")) {
      branchLine = branchLine.slice(3);
      if (branchLine.startsWith("No commits yet on "))
        branch = branchLine.slice("No commits yet on ".length);
      else if (branchLine.startsWith("HEAD (no branch)")) branch = "HEAD";
      else branch = branchLine.split("...")[0];
    }
    const files: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const status = line.slice(0, 2);
      if (line.length < 4) continue;
      let path = line.slice(3);
      if ((status.includes("R") || status.includes("C")) && i + 1 < lines.length) {
        path = lines[i + 1];
        i++;
      }
      files[toPosixPath(path)] = status;
    }
    return { branch, files };
  } catch {
    return null;
  }
}

/**
 * Reads the HEAD version of the file at `targetPath` via `git show`, using the
 * file's directory as the working directory so the relative path resolves the
 * same way as in the repository. Returns an empty string when the file is not
 * tracked or git is unavailable.
 */
export async function readGitHeadFile(targetPath: string, encoding?: string): Promise<string> {
  try {
    const cwd = dirname(targetPath);
    const relPath = relative(cwd, targetPath);
    const { stdout } = await execFileAsync("git", ["show", `HEAD:./${relPath}`], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      encoding: (encoding ?? "utf8") as BufferEncoding,
    });
    return stdout;
  } catch {
    return "";
  }
}
