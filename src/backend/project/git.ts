import { execFile } from "child_process";
import { dirname, relative } from "path";
import { promisify } from "util";
import type { BackendContext } from "../types";
import { resolveSafePath, toPosixPath } from "../utils";

const execFileAsync = promisify(execFile);

export function createGitHandlers(ctx: BackendContext) {
  const { storage } = ctx;

  async function getGitStatus({ projectId, cwd }: { projectId: string; cwd?: string }) {
    try {
      const project = storage.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const targetCwd = cwd ? resolveSafePath(project.cwd, cwd) : project.cwd;
      const { stdout } = await execFileAsync("git", ["status", "--porcelain", "-b", "-z"], {
        cwd: targetCwd,
        timeout: 2000,
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

  async function readGitHeadFile({
    projectId,
    relativePath,
    encoding,
  }: {
    projectId: string;
    relativePath: string;
    encoding?: string;
  }) {
    try {
      const project = storage.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const targetPath = resolveSafePath(project.cwd, relativePath);
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

  return { getGitStatus, readGitHeadFile };
}
