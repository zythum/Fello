import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  PromptResponse,
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
  open,
  copyFile,
} from "fs/promises";
import * as mimeTypes from "mime-types";
import { dirname, join, relative, extname, basename } from "path";
import { createRequire } from "module";
import { execFile } from "child_process";
import { promisify } from "util";
import { ACPBridge } from "./acp-bridge";
import { startWebUI, stopWebUI, getWebUIStatus, broadcastWebUIEvent } from "./webui";
import { isIgnorePath, resolveSafePath, toPosixPath } from "./utils";
import type { FelloIPCSchema } from "../shared/schema";
import { storageOps } from "./storage";
import { initWatcher, syncWatchers } from "./watcher";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

export const SEARCH_MAX_RESULTS = 10;
export const SEARCH_FUSE_THRESHOLD = 0.4;
const SEARCH_CACHE_TTL_MS = 60_000;

type SearchFileItem = { id: string; display: string };
type SearchCacheEntry = {
  version: number;
  builtAt: number;
  files: SearchFileItem[];
  fuse: Fuse<SearchFileItem>;
};

const projectFsVersions = new Map<string, number>();
const searchFileCache = new Map<string, SearchCacheEntry>();

type AgentType = string;
const bridgePool = new Map<AgentType, Promise<ACPBridge>>();
const pendingPermissions = new Map<
  string,
  {
    resolve: (value: RequestPermissionResponse) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }
>();

// Track sessions that are currently streaming to sync multiple clients
const activeStreamingSessions = new Set<string>();

// Track generation locks to prevent race conditions during concurrent sendMessage calls
const sessionGenerationLocks = new Map<string, string>();

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

function markProjectFsDirty(projectId: string) {
  const nextVersion = (projectFsVersions.get(projectId) ?? 0) + 1;
  projectFsVersions.set(projectId, nextVersion);
  searchFileCache.delete(projectId);
}

function getProjectFsVersion(projectId: string) {
  return projectFsVersions.get(projectId) ?? 0;
}

function clearProjectSearchState(projectId: string) {
  projectFsVersions.delete(projectId);
  searchFileCache.delete(projectId);
}

async function buildSearchIndex(cwd: string): Promise<SearchFileItem[]> {
  const fileScene = new Set<string>();
  const allFiles: SearchFileItem[] = [];

  async function collect(dir: string) {
    if (fileScene.has(dir)) return;
    fileScene.add(dir);
    const entries = await readdir(dir).catch(() => []);
    for (const name of entries) {
      const full = join(dir, name);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      if (isIgnorePath(full, cwd)) continue;
      if (fileScene.has(full)) continue;
      const rel = relative(cwd, full);
      const posixRel = toPosixPath(rel);
      allFiles.push({ id: posixRel, display: rel });
      if (s.isDirectory()) await collect(full);
    }
  }

  await collect(cwd);
  return allFiles;
}

export function initBackend(
  emitter: <K extends keyof FelloIPCSchema["events"]>(
    channel: K,
    payload: FelloIPCSchema["events"][K],
  ) => boolean,
) {
  sendEvent = (channel, payload) => {
    if (channel === "fs-changed") {
      markProjectFsDirty((payload as FelloIPCSchema["events"]["fs-changed"]).projectId);
    }
    broadcastWebUIEvent(channel, payload);
    return emitter(channel, payload);
  };
  initWatcher(sendEvent);
}

function resolveAgentRuntime(agentId: string) {
  const settings = storageOps.getSettings();
  const agent = settings.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}. Please check your settings.`);
  }
  const command = agent.command.trim();
  if (!command) {
    throw new Error(`Agent "${agent.id}" has no command configured.`);
  }

  const args = agent.args || [];
  const env = agent.env || {};

  return { command, args, env };
}

async function ensureBridge(cwd: string, agentId: AgentType): Promise<ACPBridge> {
  const connectPromise = bridgePool.get(agentId);
  if (connectPromise) {
    const pooledBridge = await connectPromise;
    if (pooledBridge.isConnected) {
      return pooledBridge;
    }
    if (bridgePool.get(agentId) === connectPromise) {
      bridgePool.delete(agentId);
    }
    await pooledBridge.kill();
  }

  const runtime = resolveAgentRuntime(agentId);
  const nextBridge = new ACPBridge(agentId, {
    command: runtime.command,
    args: runtime.args,
    env: runtime.env,
    cwd,
    onSessionUpdate: (notification: SessionNotification) => {
      sendEvent("session-update", {
        sessionId: `${agentId}:${notification.sessionId}`,
        notification,
      });
    },
    onPermissionRequest: (request: RequestPermissionRequest) => {
      const toolCallId = request.toolCall.toolCallId;
      const sent = sendEvent("permission-request", {
        sessionId: `${agentId}:${request.sessionId}`,
        request,
      });
      if (!sent) {
        return Promise.resolve({
          outcome: { outcome: "selected", optionId: "deny" },
        } satisfies RequestPermissionResponse);
      }
      return new Promise<RequestPermissionResponse>((resolve, reject) => {
        const timeoutId = setTimeout(
          () => {
            pendingPermissions.delete(toolCallId);
            reject(new Error("Request Permission Timeout"));
          },
          30 * 60 * 1000,
        );
        pendingPermissions.set(toolCallId, { resolve, timeoutId });
      });
    },
    onAgentTerminalOutput: (terminalId: string, data: string) => {
      sendEvent("agent-terminal-output", { terminalId, data });
    },
  });

  let newConnectPromise!: Promise<ACPBridge>;
  newConnectPromise = nextBridge
    .connect()
    .then(() => nextBridge)
    .catch(async (error) => {
      if (bridgePool.get(agentId) === newConnectPromise) {
        bridgePool.delete(agentId);
      }
      await nextBridge.kill();
      throw error;
    });

  bridgePool.set(agentId, newConnectPromise);

  return newConnectPromise;
}

export async function killBridge() {
  const killPromises: Promise<void>[] = [];
  for (const p of bridgePool.values()) {
    killPromises.push(p.then((b) => b.kill()).catch(() => {}));
  }
  bridgePool.clear();
  for (const terminal of terminals.values()) {
    terminal.kill();
  }
  terminals.clear();
  await Promise.all(killPromises);
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

export const backendHandlers: {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
} = {
  async getWebUIStatus() {
    return getWebUIStatus();
  },

  async startWebUIServer({ port, token }) {
    const { url } = await startWebUI({ port, token });
    const status = { enabled: true, url: url };
    sendEvent("webui-status-changed", { status });
    return status;
  },

  async stopWebUIServer() {
    stopWebUI();
    const status = { enabled: false, url: null };
    sendEvent("webui-status-changed", { status });
    return status;
  },

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
    const result = storageOps.addProject(cwd);
    if (!projectFsVersions.has(result.project.id)) {
      projectFsVersions.set(result.project.id, 0);
    }
    syncWatchers();
    sendEvent("projects-changed", undefined);
    return result;
  },

  async renameProject({ projectId, title }) {
    storageOps.updateProjectTitle(projectId, title);
    sendEvent("projects-changed", undefined);
  },

  async deleteProject(projectId: string) {
    storageOps.deleteProject(projectId);
    clearProjectSearchState(projectId);
    syncWatchers();
    sendEvent("projects-changed", undefined);
    sendEvent("sessions-changed", undefined);
  },

  async newSession({ projectId, agentId }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project does not exist");
    const b = await ensureBridge(project.cwd, agentId);
    const {
      sessionId: resumeId,
      models,
      modes,
    } = await b.newSession({ cwd: project.cwd, mcpServers: [] });
    const sessionId = storageOps.createSession(project.id, resumeId, agentId);
    sendEvent("sessions-changed", undefined);
    return {
      sessionId: sessionId,
      agentInfo: b.agentInfo,
      models: models ?? null,
      modes: modes ?? null,
      isStreaming: false,
    };
  },

  async loadSession({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const b = await ensureBridge(session.cwd, session.agentId);
    const { models, modes } = await b.loadSession({
      sessionId: session.resumeId,
      cwd: session.cwd,
      mcpServers: [],
      _meta: {
        client: "Fello",
      },
    });
    return {
      sessionId: session.id,
      agentInfo: b.agentInfo,
      models: models ?? null,
      modes: modes ?? null,
      isStreaming: activeStreamingSessions.has(session.id),
    };
  },

  async sendMessage({ sessionId, contents }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) throw new Error("Agent bridge not found for session");
    const b = await connectPromise;
    storageOps.touchSession(sessionId);
    sendEvent("sessions-changed", undefined);

    // Generate a unique ID for this generation attempt to prevent race conditions
    const currentGenerationId = crypto.randomUUID();
    sessionGenerationLocks.set(sessionId, currentGenerationId);
    activeStreamingSessions.add(sessionId);

    // Broadcast user message to clients
    for (const content of contents) {
      const notification: SessionNotification = {
        sessionId: session.resumeId,
        update: {
          sessionUpdate: "user_message_chunk",
          content: content,
        },
      };
      sendEvent("session-update", {
        sessionId: session.id,
        notification: notification,
      });
    }

    // Broadcast streaming start
    sendEvent("session-update", {
      sessionId: session.id,
      notification: {
        sessionId: session.resumeId,
        update: {
          sessionUpdate: "session_info_update",
          _meta: { isStreaming: true },
        },
      },
    });

    let promptResponse: PromptResponse | undefined;
    try {
      promptResponse = await b.sendPrompt({
        sessionId: session.resumeId,
        prompt: contents,
      });
      return promptResponse;
    } finally {
      // Only broadcast end and clear state if this is still the active generation
      if (sessionGenerationLocks.get(sessionId) === currentGenerationId) {
        sessionGenerationLocks.delete(sessionId);
        activeStreamingSessions.delete(sessionId);

        // Broadcast streaming end
        sendEvent("session-update", {
          sessionId: session.id,
          notification: {
            sessionId: session.resumeId,
            update: {
              sessionUpdate: "session_info_update",
              _meta: {
                isStreaming: false,
                usage: promptResponse?.usage,
                stopReason: promptResponse?.stopReason,
              },
            },
          },
        });
      }
    }
  },

  async cancelPrompt({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) return;
    const connectPromise = bridgePool.get(session.agentId);
    if (connectPromise) {
      const b = await connectPromise;
      await b.cancel({ sessionId: session.resumeId });
    }
  },

  async respondPermission({ toolCallId, optionId }) {
    const pending = pendingPermissions.get(toolCallId);
    if (pending && optionId) {
      clearTimeout(pending.timeoutId);
      pending.resolve({ outcome: { outcome: "selected", optionId } });
      pendingPermissions.delete(toolCallId);
    }
  },

  async updateSessionTitle({ sessionId, title }) {
    storageOps.updateSessionTitle(sessionId, title);
    sendEvent("sessions-changed", undefined);
  },

  async changeWorkDir() {
    return { ok: false, cwd: null };
  },

  async deleteSession(sessionId: string) {
    storageOps.deleteSession(sessionId);
    sendEvent("sessions-changed", undefined);
  },

  async getSystemFilePath({ projectId, path: inputPath, isAbsolute }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");

    if (isAbsolute) {
      return resolveSafePath(project.cwd, inputPath);
    }
    return relative(project.cwd, resolveSafePath(project.cwd, inputPath));
  },

  async copyFileToWorkspace({ projectId, sourcePath, destDir }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = destDir || project.cwd;

    const fileName = basename(sourcePath);
    let destPath = join(cwd, fileName);
    let counter = 1;

    while (true) {
      const info = await stat(destPath).catch(() => null);
      if (!info) break;
      const ext = extname(fileName);
      const name = basename(fileName, ext);
      destPath = join(cwd, `${name}(${counter})${ext}`);
      counter++;
    }

    await copyFile(sourcePath, destPath);
    markProjectFsDirty(projectId);
    return { success: true, destPath: toPosixPath(relative(cwd, destPath)) };
  },

  async readUrlAsDataUrl({ url: inputUrl, mimeType }) {
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit

    // 如果是 http(s)，我们可以在这里通过 fetch 下载，但这部分也可以由前端直接加载
    // 为了满足“读取URL为DataUrl”的能力，这里也支持对 http 资源的获取
    if (inputUrl.startsWith("http://") || inputUrl.startsWith("https://")) {
      try {
        const res = await fetch(inputUrl, { method: "HEAD" });
        if (res.ok) {
          const contentLength = res.headers.get("content-length");
          if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
            throw new Error(`File is too large (exceeds 20MB)`);
          }
        }
      } catch (err) {
        // 忽略 HEAD 请求的失败（如 405 Method Not Allowed 或 CORS 问题）
        // 我们会继续尝试通过 GET 请求下载，并在拿到数据时进行大小校验
        if (err instanceof Error && err.message.includes("exceeds 20MB")) {
          throw err;
        }
      }

      const getRes = await fetch(inputUrl);
      if (!getRes.ok) throw new Error(`Failed to fetch URL: ${getRes.statusText}`);

      const arrayBuffer = await getRes.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
        throw new Error(`File is too large (exceeds 20MB)`);
      }

      const buffer = Buffer.from(arrayBuffer);
      const data = buffer.toString("base64");
      const mime = mimeType || getRes.headers.get("content-type") || "application/octet-stream";
      return `data:${mime};base64,${data}`;
    }

    let inputPath = "";
    if (inputUrl.startsWith("file://")) {
      inputPath = decodeURIComponent(inputUrl.slice(7));
    } else {
      throw new Error(`Unsupported protocol or path format: ${inputUrl}`);
    }

    // 因为我们要求 uri 必须是 file:// 协议（绝对路径），所以不再依赖 project.cwd
    // 直接读取本地系统路径即可
    const safePath = inputPath;

    const fileStat = await stat(safePath);
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(`File is too large (exceeds 20MB)`);
    }

    const data = await fsReadFile(safePath, "base64");

    let mime = mimeType;
    if (!mime) {
      mime = mimeTypes.lookup(safePath) || "application/octet-stream";
    }

    return `data:${mime};base64,${data}`;
  },

  async getModels({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) return null;
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) return null;
    const b = await connectPromise;
    return b.getModelState(session.resumeId);
  },

  async setModel({ sessionId, modelId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) throw new Error("Agent bridge not found for session");
    const b = await connectPromise;
    await b.setSessionModel({ sessionId: session.resumeId, modelId });
  },

  async getModes({ sessionId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) return null;
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) return null;
    const b = await connectPromise;
    return b.getModeState(session.resumeId);
  },

  async setMode({ sessionId, modeId }) {
    const session = storageOps.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const connectPromise = bridgePool.get(session.agentId);
    if (!connectPromise) throw new Error("Agent bridge not found for session");
    const b = await connectPromise;
    await b.setSessionMode({ sessionId: session.resumeId, modeId });
  },

  async searchFiles({ projectId, query }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = project.cwd;

    const fileScene = new Set<string>();

    if (!query || query.trim() === "") {
      const entries = await readdir(cwd).catch(() => []);
      const results: Array<{ id: string; display: string }> = [];
      for (const name of entries) {
        const full = join(cwd, name);
        if (isIgnorePath(full, cwd)) continue;

        if (fileScene.has(full)) continue;
        fileScene.add(full);
        const rel = relative(cwd, full);
        results.push({ id: toPosixPath(rel), display: rel });
        if (results.length >= SEARCH_MAX_RESULTS) break;
      }
      results.sort((a, b) => a.display.localeCompare(b.display));
      return results;
    }

    const normalizedQuery = toPosixPath(query);
    const currentVersion = getProjectFsVersion(projectId);
    const cached = searchFileCache.get(projectId);
    let entry: SearchCacheEntry;
    if (
      cached &&
      cached.version === currentVersion &&
      Date.now() - cached.builtAt <= SEARCH_CACHE_TTL_MS
    ) {
      entry = cached;
    } else {
      const files = await buildSearchIndex(cwd);
      entry = {
        version: currentVersion,
        builtAt: Date.now(),
        files,
        fuse: new Fuse(files, {
          keys: ["display"],
          threshold: SEARCH_FUSE_THRESHOLD,
        }),
      };
      searchFileCache.set(projectId, entry);
    }

    return entry.fuse
      .search(normalizedQuery, { limit: SEARCH_MAX_RESULTS })
      .map((result) => result.item);
  },

  async readDir({ projectId, relativePath = "" }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const cwd = project.cwd;

    const startPath = resolveSafePath(cwd, relativePath);

    const entries = await readdir(startPath).catch(() => []);
    const results: { id: string; name: string; isFolder: boolean }[] = [];
    for (const name of entries) {
      const full = join(startPath, name);
      const s = await stat(full).catch(() => null);
      if (!s) continue;

      if (isIgnorePath(full, cwd)) continue;

      const relId = toPosixPath(relative(cwd, full));
      if (s.isDirectory()) {
        results.push({ id: relId, name, isFolder: true });
      } else {
        results.push({ id: relId, name, isFolder: false });
      }
    }

    results.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  },

  async createFile({ projectId, relativePath, isFolder }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);

    if (isFolder) {
      await mkdir(targetPath, { recursive: true });
    } else {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, "");
    }
    markProjectFsDirty(projectId);
  },

  async deleteFile({ projectId, relativePath }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);
    await rm(targetPath, { recursive: true, force: true });
    markProjectFsDirty(projectId);
  },

  async getPlatform() {
    return process.platform;
  },

  async renameFile({ projectId, oldRelativePath, newRelativePath }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const oldPath = resolveSafePath(project.cwd, oldRelativePath);
    const newPath = resolveSafePath(project.cwd, newRelativePath);
    await rename(oldPath, newPath);
    markProjectFsDirty(projectId);
  },

  async moveFile({ projectId, oldRelativePath, newRelativePath }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const oldPath = resolveSafePath(project.cwd, oldRelativePath);
    const newPath = resolveSafePath(project.cwd, newRelativePath);
    await rename(oldPath, newPath);
    markProjectFsDirty(projectId);
  },

  async readFile({ projectId, relativePath, encoding }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);
    return fsReadFile(targetPath, encoding ?? "utf8");
  },

  async getFileInfo({ projectId, relativePath }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetPath = resolveSafePath(project.cwd, relativePath);

    try {
      const s = await stat(targetPath);
      let isBinary = false;
      if (s.isFile() && s.size > 0) {
        const fd = await open(targetPath, "r");
        try {
          const buffer = Buffer.alloc(512);
          const { bytesRead } = await fd.read(buffer, 0, 512, 0);
          for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) {
              isBinary = true;
              break;
            }
          }
        } finally {
          await fd.close();
        }
      }
      return { size: s.size, isFile: s.isFile(), isBinary };
    } catch {
      return null;
    }
  },

  async writeExternalFile({ projectId, fileName, base64, destRelativeDir }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const destDir = resolveSafePath(project.cwd, destRelativeDir || "");

    const ext = extname(fileName);
    const base = basename(fileName, ext);
    let counter = 0;
    let currentDest = join(destDir, fileName);

    while (true) {
      const existing = await stat(currentDest).catch(() => null);
      if (!existing) break; // Path is free

      if (counter === 0 && existing.isDirectory()) {
        throw new Error("Cannot overwrite a folder with a file");
      }

      counter++;
      currentDest = join(destDir, `${base}(${counter})${ext}`);
    }

    const buffer = Buffer.from(base64, "base64");
    await mkdir(destDir, { recursive: true });
    await writeFile(currentDest, buffer);
    markProjectFsDirty(projectId);
  },

  async createTerminal({ projectId, cwd, cols, rows }) {
    const project = storageOps.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const targetCwd = cwd ? resolveSafePath(project.cwd, cwd) : project.cwd;

    return { terminalId: await createTerminalProcess(targetCwd, { cols, rows }) };
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

  async getAgentTerminalOutput({ terminalId }) {
    for (const connectPromise of bridgePool.values()) {
      try {
        const b = await connectPromise;
        const output = b.terminalManager.getOutput(terminalId);
        if (output?.output) return output.output;
      } catch {
        continue;
      }
    }
    return "";
  },

  async getGitStatus({ projectId, cwd }) {
    try {
      const project = storageOps.getProject(projectId);
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
        files[toPosixPath(path)] = status;
      }
      return { branch, files };
    } catch {
      return null;
    }
  },

  async readGitHeadFile({ projectId, relativePath, encoding }) {
    try {
      const project = storageOps.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const targetPath = resolveSafePath(project.cwd, relativePath);

      const cwd = dirname(targetPath);
      const relPath = relative(cwd, targetPath);
      const { stdout } = await execFileAsync("git", ["show", `HEAD:./${relPath}`], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        encoding: encoding ?? "utf8",
      });
      return stdout;
    } catch {
      return "";
    }
  },
};

export { type FelloIPCSchema };
