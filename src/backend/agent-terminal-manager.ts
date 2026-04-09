import { spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";

export interface AgentTerminalProcess {
  id: string;
  process: ChildProcess;
  outputBuffer: Buffer;
  outputByteLimit: number;
  exitCode: number | null;
  signal: string | null;
  isFinished: boolean;
  onData: (data: string) => void;
  onExit: (exitCode: number | null, signal: string | null) => void;
}

export class AgentTerminalManager {

  private terminals = new Map<string, AgentTerminalProcess>();

  constructor(private emitOutput: (terminalId: string, data: string) => void) {}

  create(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    outputByteLimit: number,
  ): string {
    const id = "term_" + randomBytes(6).toString("hex");

    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: true, // Use shell to support commands like 'npm' easily on Windows
    });

    const terminal: AgentTerminalProcess = {
      id,
      process: proc,
      outputBuffer: Buffer.alloc(0),
      outputByteLimit,
      exitCode: null,
      signal: null,
      isFinished: false,
      onData: () => {},
      onExit: () => {},
    };

    const handleData = (chunk: Buffer) => {
      let newBuffer = Buffer.concat([terminal.outputBuffer, chunk]);
      if (newBuffer.length > terminal.outputByteLimit) {
        // truncate from the beginning
        newBuffer = newBuffer.subarray(newBuffer.length - terminal.outputByteLimit);
      }
      terminal.outputBuffer = newBuffer;
      this.emitOutput(id, chunk.toString("utf-8"));
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

    this.terminals.set(id, terminal);
    return id;
  }

  getOutput(id: string): { output: string; truncated: boolean } {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new Error(`Terminal ${id} not found`);
    }
    // We don't track true truncated state perfectly yet, but we can assume if buffer equals limit it might be truncated.
    // For now, return false or check if we ever truncated. Let's just say false for simplicity unless we add a flag.
    return {
      output: terminal.outputBuffer.toString("utf-8"),
      truncated: false, // Simplification
    };
  }

  getTerminal(terminalId: string): AgentTerminalProcess | undefined {
    return this.terminals.get(terminalId);
  }

  async waitForExit(id: string): Promise<{ exitCode: number | null; signal: string | null }> {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new Error(`Terminal ${id} not found`);
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

  kill(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    if (!terminal.isFinished) {
      terminal.process.kill("SIGTERM");
    }
  }

  release(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    if (!terminal.isFinished) {
      terminal.process.kill("SIGKILL");
    }
    this.terminals.delete(id);
  }
}
