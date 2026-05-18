import { spawn, ChildProcess, execFileSync } from "child_process";
import type { AgentProcess } from "./base-agent";
import { WORKSPACE_TEMP_DIR } from "../storage";
import { Writable, Readable } from "stream";

interface StdioAgentOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function spawnStdioAgent(options: StdioAgentOptions): AgentProcess {
  const shouldDetach = process.platform !== "win32";
  const proc = spawn(options.command, options.args, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: WORKSPACE_TEMP_DIR,
    env: { ...process.env, ...options.env },
    detached: shouldDetach,
  });
  if (shouldDetach) {
    proc.unref();
  }

  let closed = false;

  async function close(): Promise<void> {
    if (closed) {
      return;
    }
    closed = true;
    try {
      proc.stdin.end();
    } catch {}
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) {
        resolve();
        return;
      }
      let killTimer: NodeJS.Timeout | null = null;
      const onExit = () => {
        if (killTimer) {
          clearTimeout(killTimer);
        }
        resolve();
      };
      proc.once("exit", onExit);
      killProcessGroup(proc, "SIGTERM");
      killTimer = setTimeout(() => {
        killProcessGroup(proc, "SIGKILL");
        resolve();
      }, 2000);
    });
  }

  function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
    const pid = proc.pid;
    if (pid == null) return;
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
        return;
      } catch {
        try {
          proc.kill(signal);
          return;
        } catch {}
      }
    }
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {}
    }
  }

  const input = Writable.toWeb(proc.stdin!);
  const output = Readable.toWeb(proc.stdout!) as ReadableStream<any>;

  return {
    input,
    output,
    close,
  };
}
