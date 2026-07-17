import { homedir } from "os";
import { spawn as spawnPty } from "node-pty";
import { createHash } from "crypto";
import { chmod, stat } from "fs/promises";
import { dirname, join } from "path";
import { createRequire } from "module";
import type { BackendContext } from "./types";
import { resolveSafePath } from "./utils";
import type { ACPBridge } from "./agent/agent-bridge";

const require = createRequire(import.meta.url);

// ── Types ────────────────────────────────────────────────────────────

type ManagedTerminal = {
  write: (data: string) => void;
  kill: () => void;
  resize: (cols: number, rows: number) => void;
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (exitCode: number | null) => void) => void;
};

export interface TerminalModule {
  registerClient: (params: { clientId: string }) => Promise<void>;
  createTerminal: (params: {
    projectId: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    clientId?: string;
  }) => Promise<{ terminalId: string }>;
  writeTerminal: (params: { terminalId: string; data: string }) => Promise<{ ok: boolean }>;
  killTerminalsByClient: (params: { clientId: string }) => Promise<{ terminalIds: string[] }>;
  killTerminal: (params: { terminalId: string }) => Promise<{ terminalId?: string }>;
  resizeTerminal: (params: {
    terminalId: string;
    cols: number;
    rows: number;
  }) => Promise<{ ok: boolean }>;
  getAgentTerminalOutput: (params: { sessionId: string; terminalId: string }) => Promise<string>;
  killAllTerminals: () => void;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createTerminalModule(
  ctx: BackendContext,
  deps: { bridges: Map<string, Promise<ACPBridge>> },
): TerminalModule {
  const { sendEvent, storage } = ctx;
  const terminals = new Map<string, ManagedTerminal>();
  const clientTerminals = new Map<string, Set<string>>();
  let terminalCounter = 0;
  let isNodePtyHelperPrepared = false;

  // ── Internals ──────────────────────────────────────────────────────

  async function resolveTerminalCwd(preferredCwd: string) {
    const candidates = [preferredCwd, process.cwd(), homedir()]
      .map((value) => value.trim())
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
    for (const candidate of candidates) {
      const info = await stat(candidate).catch(() => null);
      if (info?.isDirectory()) return candidate;
    }
    return process.cwd();
  }

  function resolveShellCandidates() {
    if (process.platform === "win32") {
      return [process.env.COMSPEC?.trim() ?? "", "powershell.exe", "cmd.exe"].filter(
        (value, index, array) => value.length > 0 && array.indexOf(value) === index,
      );
    }
    return [process.env.SHELL?.trim() ?? "", "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
      (value, index, array) => value.length > 0 && array.indexOf(value) === index,
    );
  }

  async function ensureNodePtySpawnHelperExecutable() {
    if (process.platform === "win32") return;
    if (isNodePtyHelperPrepared) return;
    const packageJsonPath = require.resolve("node-pty/package.json");
    const packageDir = dirname(packageJsonPath);
    const helperPath = join(
      packageDir,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    );
    const info = await stat(helperPath).catch(() => null);
    if (!info?.isFile()) {
      throw new Error(`node-pty spawn-helper not found: ${helperPath}`);
    }
    if ((info.mode & 0o111) === 0) {
      await chmod(helperPath, 0o755);
    }
    isNodePtyHelperPrepared = true;
  }

  async function createTerminalProcess(
    cwd: string,
    initialSize?: { cols?: number; rows?: number },
  ) {
    const ptyShellArgs = process.platform === "win32" ? [] : ["-i"];
    const resolvedCwd = await resolveTerminalCwd(cwd);
    const shellCandidates = resolveShellCandidates();
    let child: ManagedTerminal | null = null;
    let lastError: unknown = null;

    const createPtyTerminal = (shellPath: string) => {
      const pty = spawnPty(shellPath, ptyShellArgs, {
        cwd: resolvedCwd,
        cols: Math.max(20, Math.floor(initialSize?.cols ?? 80)),
        rows: Math.max(6, Math.floor(initialSize?.rows ?? 24)),
        name: "xterm-256color",
        env: { ...process.env, TERM: "xterm-256color" },
      });
      return {
        write: (data: string) => pty.write(data),
        kill: () => pty.kill(),
        resize: (cols: number, rows: number) => pty.resize(cols, rows),
        onData: (listener: (data: string) => void) => {
          pty.onData((data) => listener(data));
        },
        onExit: (listener: (exitCode: number | null) => void) => {
          pty.onExit(({ exitCode }) => listener(exitCode));
        },
      } satisfies ManagedTerminal;
    };

    try {
      await ensureNodePtySpawnHelperExecutable();
    } catch (error) {
      lastError = error;
    }

    for (const shellPath of shellCandidates) {
      try {
        child = createPtyTerminal(shellPath);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!child) {
      throw new Error(
        `Failed to create PTY terminal. cwd=${resolvedCwd}; ptyShells=${shellCandidates.join(", ")}; error=${String(lastError)}`,
      );
    }
    const terminalSeed = `terminal-${Date.now()}-${terminalCounter++}`;
    const terminalId = createHash("sha1").update(terminalSeed).digest("hex").slice(0, 12);
    terminals.set(terminalId, child);
    child.onData((data: string) => {
      sendEvent("terminal-output", { terminalId, data });
    });
    child.onExit((exitCode: number | null) => {
      terminals.delete(terminalId);
      for (const set of clientTerminals.values()) {
        set.delete(terminalId);
      }
      sendEvent("terminal-exit", { terminalId, exitCode });
    });
    return terminalId;
  }

  // ── Handlers ───────────────────────────────────────────────────────

  async function registerClient({ clientId }: { clientId: string }) {
    if (!clientTerminals.has(clientId)) {
      clientTerminals.set(clientId, new Set());
    }
  }

  async function createTerminal({
    projectId,
    cwd,
    cols,
    rows,
    clientId,
  }: {
    projectId: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    clientId?: string;
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetCwd = cwd ? resolveSafePath(project.cwd, cwd) : project.cwd;

    const terminalId = await createTerminalProcess(targetCwd, { cols, rows });
    if (clientId) {
      let set = clientTerminals.get(clientId);
      if (!set) {
        set = new Set();
        clientTerminals.set(clientId, set);
      }
      set.add(terminalId);
    }
    return { terminalId };
  }

  async function writeTerminal({ terminalId, data }: { terminalId: string; data: string }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.write(data);
    return { ok: true };
  }

  async function killTerminalsByClient({ clientId }: { clientId: string }) {
    const termIds = clientTerminals.get(clientId);
    const terminalIds = termIds ? [...termIds] : [];
    for (const tid of terminalIds) {
      const terminal = terminals.get(tid);
      if (terminal) {
        terminal.kill();
        terminals.delete(tid);
      }
    }
    clientTerminals.delete(clientId);
    return { terminalIds };
  }

  async function killTerminal({ terminalId }: { terminalId: string }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return {};
    terminal.kill();
    terminals.delete(terminalId);
    for (const set of clientTerminals.values()) {
      set.delete(terminalId);
    }
    return { terminalId };
  }

  async function resizeTerminal({
    terminalId,
    cols,
    rows,
  }: {
    terminalId: string;
    cols: number;
    rows: number;
  }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    return { ok: true };
  }

  async function getAgentTerminalOutput({
    sessionId,
    terminalId,
  }: {
    sessionId: string;
    terminalId: string;
  }) {
    for (const connectPromise of deps.bridges.values()) {
      try {
        const b = await connectPromise;
        const output = b.terminalManager.getOutput(terminalId);
        if (output?.output) return output.output;
      } catch {
        continue;
      }
    }
    return storage.readTerminalOutput(sessionId, terminalId) || "";
  }

  function killAllTerminals() {
    for (const terminal of terminals.values()) {
      terminal.kill();
    }
    terminals.clear();
    clientTerminals.clear();
  }

  return {
    registerClient,
    createTerminal,
    writeTerminal,
    killTerminalsByClient,
    killTerminal,
    resizeTerminal,
    getAgentTerminalOutput,
    killAllTerminals,
  };
}
