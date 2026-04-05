import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import Fuse from "fuse.js";
import { homedir } from "os";
import { spawn as spawnPty } from "node-pty";
import { createHash } from "crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile as fsReadFile,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { dirname, join, relative } from "path";
import { createRequire } from "module";
import { execFile } from "child_process";
import { promisify } from "util";
import { ACPBridge } from "./acp-bridge";

const execFileAsync = promisify(execFile);
import type { FelloIPCSchema } from "./ipc-schema";
import { storageOps } from "./storage";

const require = createRequire(import.meta.url);

type AgentType = string;
const bridgePool = new Map<AgentType, ACPBridge>();
let bridge: ACPBridge | null = null;
let activeSessionId: string | null = null;
let activeStorageSessionId: string | null = null;
const pendingPermissions = new Map<string, (value: RequestPermissionResponse) => void>();

type ManagedTerminal = {
  write: (data: string) => void;
  kill: () => void;
  resize: (cols: number, rows: number) => void;
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (exitCode: number | null) => void) => void;
};
const terminals = new Map<string, ManagedTerminal>();
let terminalCounter = 0;
let isNodePtyHelperPrepared = false;

let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

export function initBackend(
  emitter: <K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ) => boolean,
) {
  sendEvent = emitter;
}

function resolveAgentRuntime(agentId: string) {
  const settings = storageOps.getSettings();
  const agent = settings.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}. Please check your settings.`);
  }
  const command = agent.command.trim();
  if (!command) {
    throw new Error(`Agent "${agent.name}" has no command configured.`);
  }

  const args = agent.args || [];
  const commandLabel = [command, ...args].join(" ");
  const env = agent.env || {};

  return { command, args, commandLabel, env };
}

export function extractErrorMessage(error: unknown): string {
  const visited = new Set<unknown>();

  const walk = (value: unknown, depth: number): string | null => {
    if (depth > 4) return null;
    if (typeof value === "string") {
      const text = value.trim();
      return text.length > 0 ? text : null;
    }
    if (value instanceof Error) {
      const text = value.message?.trim();
      return text?.length ? text : null;
    }
    if (!value || typeof value !== "object") return null;
    if (visited.has(value)) return null;
    visited.add(value);

    const record = value as Record<string, unknown>;
    const candidates = [
      record.message,
      record.error,
      record.data,
      typeof record.data === "object" && record.data
        ? (record.data as Record<string, unknown>).message
        : null,
      typeof record.data === "object" && record.data
        ? (record.data as Record<string, unknown>).error
        : null,
    ];
    for (const candidate of candidates) {
      const message = walk(candidate, depth + 1);
      if (message) return message;
    }
    return null;
  };

  const message = walk(error, 0);
  if (message) return message;
  const fallback = String(error).trim();
  if (fallback && fallback !== "[object Object]") return fallback;
  return "Unknown error";
}

async function ensureBridge(cwd: string, agent: AgentType): Promise<ACPBridge> {
  const pooledBridge = bridgePool.get(agent);
  if (pooledBridge?.isConnected) {
    bridge = pooledBridge;
    return pooledBridge;
  }
  if (pooledBridge) {
    await pooledBridge.disconnect().catch(() => {});
    bridgePool.delete(agent);
  }
  const runtime = resolveAgentRuntime(agent);
  const nextBridge = new ACPBridge({
    command: runtime.command,
    args: runtime.args,
    env: runtime.env,
    cwd,
    onSessionUpdate: (params: SessionNotification) => sendEvent("session-update", params),
    onPermissionRequest: (params: RequestPermissionRequest) => {
      const toolCallId = params.toolCall.toolCallId;
      const sent = sendEvent("permission-request", params);
      if (!sent) {
        return Promise.resolve({
          outcome: { outcome: "selected", optionId: "deny" },
        } as RequestPermissionResponse);
      }
      return new Promise<RequestPermissionResponse>((resolve) => {
        pendingPermissions.set(toolCallId, resolve);
      });
    },
    onAgentTerminalOutput: (terminalId: string, data: string) => {
      sendEvent("agent-terminal-output", { terminalId, data });
    },
  });
  await nextBridge.connect();
  bridgePool.set(agent, nextBridge);
  bridge = nextBridge;
  return nextBridge;
}

export async function cleanupAll() {
  const allBridges = [...bridgePool.values()];
  for (const pooledBridge of allBridges) {
    await pooledBridge.disconnect().catch(() => {});
  }
  bridgePool.clear();
  bridge = null;
  for (const terminal of terminals.values()) {
    terminal.kill();
  }
  terminals.clear();
}

export function killBridgeSync() {
  const allBridges = [...bridgePool.values()];
  for (const pooledBridge of allBridges) {
    pooledBridge.killSync();
  }
  bridgePool.clear();
  bridge = null;
  for (const terminal of terminals.values()) {
    terminal.kill();
  }
  terminals.clear();
}

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

async function createTerminalProcess(cwd: string, initialSize?: { cols?: number; rows?: number }) {
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
    sendEvent("terminal-exit", { terminalId, exitCode });
  });
  return terminalId;
}

function formatModels(models: any) {
  if (!models) return null;
  return {
    availableModels: models.availableModels.map((m: any) => ({
      modelId: m.modelId,
      name: m.name,
      description: m.description ?? null,
    })),
    currentModelId: models.currentModelId,
  };
}

function formatModes(modes: any) {
  if (!modes) return null;
  return {
    availableModes: modes.availableModes.map((mode: any) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description ?? null,
    })),
    currentModeId: modes.currentModeId,
  };
}

export const backendHandlers: {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
} = {
  async getSettings() {
    return storageOps.getSettings();
  },

  async updateSettings(settings) {
    storageOps.updateSettings(settings);
  },

  async listSessions() {
    return storageOps.listSessions();
  },

  async listProjects() {
    return storageOps.listProjects();
  },

  async addProject(cwd: string) {
    return storageOps.addProject(cwd);
  },

  async renameProject({ projectId, title }) {
    storageOps.updateProjectTitle(projectId, title);
  },

  async deleteProject(projectId: string) {
    const activeSession = activeStorageSessionId
      ? storageOps.getSession(activeStorageSessionId)
      : null;
    storageOps.deleteProject(projectId);
    if (activeSession?.project_id === projectId) {
      activeStorageSessionId = null;
      activeSessionId = null;
    }
  },

  async newSession({ projectId, agentId }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project does not exist");
    const runtime = resolveAgentRuntime(agentId);
    const b = await ensureBridge(project.cwd, agentId);
    const { sessionId, models, modes } = await b.newSession(project.cwd);
    const storageSessionId = storageOps.createSession(
      project.id,
      sessionId,
      runtime.commandLabel,
      agentId,
    );
    activeSessionId = sessionId;
    activeStorageSessionId = storageSessionId;
    return {
      sessionId: storageSessionId,
      agentInfo: b.agentInfo,
      models: formatModels(models),
      modes: formatModes(modes),
    };
  },

  async loadSession({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const b = await ensureBridge(session.cwd, session.agent);
    const { models, modes } = await b.loadSession(session.acp_session_id, session.cwd);
    activeSessionId = session.acp_session_id;
    activeStorageSessionId = session.id;
    return {
      sessionId: session.id,
      agentInfo: b.agentInfo,
      models: formatModels(models),
      modes: formatModes(modes),
    };
  },

  async sendMessage(text: string) {
    if (!bridge || !activeSessionId) throw new Error("No active session");
    if (activeStorageSessionId) storageOps.touchSession(activeStorageSessionId);
    return await bridge.sendPrompt(activeSessionId, text);
  },

  async cancelPrompt() {
    if (bridge && activeSessionId) await bridge.cancel(activeSessionId);
  },

  async respondPermission({ toolCallId, optionId }) {
    const resolve = pendingPermissions.get(toolCallId);
    if (resolve && optionId) {
      resolve({ outcome: { outcome: "selected", optionId } });
      pendingPermissions.delete(toolCallId);
    }
  },

  async updateSessionTitle({ sessionId, title }) {
    storageOps.updateSessionTitle(sessionId, title);
  },

  async changeWorkDir() {
    return { ok: false, cwd: null };
  },

  async deleteSession(sessionId: string) {
    storageOps.deleteSession(sessionId);
    if (activeStorageSessionId === sessionId) {
      activeStorageSessionId = null;
      activeSessionId = null;
    }
  },

  async disconnect() {
    await cleanupAll();
    activeSessionId = null;
    activeStorageSessionId = null;
  },

  async getCwd() {
    return process.cwd();
  },

  async getModels() {
    if (!bridge || !activeSessionId) return null;
    return formatModels(bridge.getModelState(activeSessionId));
  },

  async setModel(modelId: string) {
    if (!bridge || !activeSessionId) throw new Error("No active session");
    await bridge.setSessionModel(activeSessionId, modelId);
  },

  async getModes() {
    if (!bridge || !activeSessionId) return null;
    return formatModes(bridge.getModeState(activeSessionId));
  },

  async setMode(modeId: string) {
    if (!bridge || !activeSessionId) throw new Error("No active session");
    await bridge.setSessionMode(activeSessionId, modeId);
  },

  async searchFiles({ cwd, query }) {
    const ignore = new Set([
      "node_modules",
      ".git",
      ".DS_Store",
      "dist",
      "build",
      ".next",
      ".cache",
      "__pycache__",
      ".vscode",
      "out",
    ]);
    const maxResults = 10;

    if (!query || query.trim() === "") {
      const entries = await readdir(cwd).catch(() => []);
      const results: Array<{ id: string; display: string }> = [];
      for (const name of entries) {
        if (ignore.has(name)) continue;
        const full = join(cwd, name);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        results.push({ id: full, display: name });
        if (results.length >= maxResults) break;
      }
      results.sort((a, b) => a.display.localeCompare(b.display));
      return results;
    }

    const allFiles: Array<{ id: string; display: string }> = [];

    async function collect(dir: string) {
      const entries = await readdir(dir).catch(() => []);
      for (const name of entries) {
        if (ignore.has(name)) continue;
        const full = join(dir, name);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        allFiles.push({ id: full, display: relative(cwd, full) });
        if (s.isDirectory()) await collect(full);
      }
    }

    await collect(cwd);

    const fuse = new Fuse(allFiles, {
      keys: ["display"],
      threshold: 0.4,
    });

    return fuse.search(query, { limit: maxResults }).map((result) => result.item);
  },

  async readDir({ path: dirPath, depth = 1 }) {
    const ignore = new Set([
      "node_modules",
      ".git",
      ".DS_Store",
      "dist",
      "build",
      ".next",
      ".cache",
      "__pycache__",
      ".vscode",
      "out",
    ]);

    async function walk(path: string, currentDepth: number): Promise<unknown[]> {
      const entries = await readdir(path).catch(() => []);
      const results: unknown[] = [];
      for (const name of entries) {
        if (ignore.has(name)) continue;
        const full = join(path, name);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        if (s.isDirectory()) {
          const children = currentDepth > 1 ? await walk(full, currentDepth - 1) : [];
          results.push({ id: full, name, isFolder: true, children });
        } else {
          results.push({ id: full, name, isFolder: false });
        }
      }
      results.sort((a: any, b: any) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return results;
    }

    return walk(dirPath, depth);
  },

  async createFile({ path, isFolder }) {
    if (isFolder) {
      await mkdir(path, { recursive: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
    }
  },

  async deleteFile({ path }) {
    await rm(path, { recursive: true, force: true });
  },

  async getPlatform() {
    return process.platform;
  },

  async renameFile({ oldPath, newPath }) {
    await rename(oldPath, newPath);
  },

  async moveFile({ oldPath, newPath }) {
    await rename(oldPath, newPath);
  },

  async readFile(filePath: string) {
    return fsReadFile(filePath, "utf-8");
  },

  async writeDroppedFile({ fileName, base64, destDir }) {
    let dest = join(destDir, fileName);
    const existing = await stat(dest).catch(() => null);
    if (existing) {
      const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
      const base = ext ? fileName.slice(0, -ext.length) : fileName;
      let index = 1;
      while (await stat(join(destDir, `${base} (${index})${ext}`)).catch(() => null)) index++;
      dest = join(destDir, `${base} (${index})${ext}`);
    }
    await writeFile(dest, Buffer.from(base64, "base64"));
  },

  async writeDroppedFolder({ destDir }) {
    await mkdir(destDir, { recursive: true });
  },

  async createTerminal({ sessionId, cwd: requestedCwd, cols, rows }) {
    const session = storageOps.getSession(sessionId);
    const cwd = requestedCwd?.trim() || session?.cwd?.trim() || "";
    if (!cwd) {
      throw new Error(`Failed to create terminal: missing cwd for session ${sessionId}`);
    }
    return { terminalId: await createTerminalProcess(cwd, { cols, rows }) };
  },

  async writeTerminal({ terminalId, data }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.write(data);
    return { ok: true };
  },

  async killTerminal({ terminalId }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.kill();
    terminals.delete(terminalId);
    return { ok: true };
  },

  async resizeTerminal({ terminalId, cols, rows }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    return { ok: true };
  },

  async getAgentTerminalOutput(terminalId: string) {
    if (!bridge) return "";
    try {
      const output = bridge.terminalManager.getOutput(terminalId);
      return output?.output || "";
    } catch {
      return "";
    }
  },

  async getGitStatus({ cwd }) {
    try {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain", "-b", "-z"], {
        cwd,
        timeout: 2000,
      });
      const lines = stdout.split("\0").filter(Boolean);
      if (lines.length === 0) return null;
      let branchLine = lines[0];
      let branch = "";
      if (branchLine.startsWith("## ")) {
        branchLine = branchLine.slice(3);
        if (branchLine.startsWith("No commits yet on ")) {
          branch = branchLine.slice("No commits yet on ".length);
        } else if (branchLine.startsWith("HEAD (no branch)")) {
          branch = "HEAD";
        } else {
          branch = branchLine.split("...")[0];
        }
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
        files[path] = status;
      }
      return { branch, files };
    } catch {
      return null;
    }
  },
};

export { type FelloIPCSchema };
