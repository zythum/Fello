import { spawn, execFileSync, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";

export interface AgentTerminalProcess {
  id: string;
  sessionId: string;
  process: ChildProcess;
  outputBuffer: Buffer;
  outputByteLimit: number;
  /** 缓冲区是否曾因超过 outputByteLimit 丢弃过开头的数据 */
  truncated: boolean;
  exitCode: number | null;
  signal: string | null;
  isFinished: boolean;
  onData: (data: string) => void;
  onExit: (exitCode: number | null, signal: string | null) => void;
  outputDecoder: InstanceType<typeof TextDecoder>;
}

function detectTerminalOutputEncoding(): "utf-8" | "gbk" {
  if (process.platform !== "win32") {
    return "utf-8";
  }
  try {
    const output = execFileSync("cmd", ["/d", "/s", "/c", "chcp"], {
      encoding: "buffer",
      windowsHide: true,
    });
    const codePage = Number.parseInt(output.toString("latin1").match(/(\d+)/)?.[1] ?? "936", 10);
    if (codePage === 65001) return "utf-8";
    if (codePage === 936 || codePage === 54936) return "gbk";
  } catch {}
  return "utf-8";
}

export class AgentTerminalManager {
  private terminals = new Map<string, AgentTerminalProcess>();

  constructor(private emitOutput: (sessionId: string, terminalId: string, data: string) => void) {}

  create(
    sessionId: string,
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    outputByteLimit: number,
  ): string {
    const terminalId = "term_" + randomBytes(6).toString("hex");

    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true, // Use shell to support commands like 'npm' easily on Windows
      windowsHide: true,
    });

    const terminal: AgentTerminalProcess = {
      id: terminalId,
      sessionId,
      process: proc,
      outputBuffer: Buffer.alloc(0),
      outputByteLimit,
      truncated: false,
      exitCode: null,
      signal: null,
      isFinished: false,
      onData: () => {},
      onExit: () => {},
      outputDecoder: new TextDecoder(detectTerminalOutputEncoding(), { fatal: false }),
    };

    const handleData = (chunk: Buffer) => {
      let newBuffer = Buffer.concat([terminal.outputBuffer, chunk]);
      if (newBuffer.length > terminal.outputByteLimit) {
        // truncate from the beginning；切点若落在多字节字符中间，则后移到字符边界，
        // 避免缓冲区（进而 rawOutput / 工具返回值）以替换字符开头
        let start = newBuffer.length - terminal.outputByteLimit;
        while (start < newBuffer.length && (newBuffer.readUInt8(start) & 0xc0) === 0x80) {
          start += 1;
        }
        newBuffer = newBuffer.subarray(start);
        terminal.truncated = true;
      }
      terminal.outputBuffer = newBuffer;
      const text = terminal.outputDecoder.decode(chunk, { stream: true });
      this.emitOutput(sessionId, terminalId, text);
    };

    proc.stdout?.on("data", handleData);
    proc.stderr?.on("data", handleData);

    proc.on("exit", (code, signal) => {
      terminal.isFinished = true;
      terminal.exitCode = code;
      terminal.signal = signal;
      terminal.onExit(code, signal);
    });

    proc.on("error", (err) => {
      handleData(Buffer.from(`\n[Error: ${err.message}]\n`));
    });

    this.terminals.set(terminalId, terminal);
    return terminalId;
  }

  getOutput(terminalId: string): { output: string; truncated: boolean } {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} not found`);
    }
    return {
      output: terminal.outputDecoder.decode(terminal.outputBuffer),
      truncated: terminal.truncated,
    };
  }

  getTerminal(terminalId: string): AgentTerminalProcess | undefined {
    return this.terminals.get(terminalId);
  }

  async waitForExit(
    terminalId: string,
  ): Promise<{ exitCode: number | null; signal: string | null }> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} not found`);
    }
    if (terminal.isFinished) {
      return { exitCode: terminal.exitCode, signal: terminal.signal };
    }
    return new Promise((resolve) => {
      const originalOnExit = terminal.onExit;
      terminal.onExit = (code, signal) => {
        originalOnExit(code, signal);
        resolve({ exitCode: code, signal });
      };
    });
  }

  kill(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    if (!terminal.isFinished) {
      terminal.process.kill("SIGTERM");
    }
  }

  release(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    if (!terminal.isFinished) {
      terminal.process.kill("SIGKILL");
    }
    this.terminals.delete(terminalId);
  }

  /** 杀死指定 session 的所有 agent 终端（发送 SIGTERM） */
  killBySession(sessionId: string): number {
    let count = 0;
    for (const terminal of this.terminals.values()) {
      if (terminal.sessionId === sessionId) {
        this.kill(terminal.id);
        count++;
      }
    }
    return count;
  }
}
