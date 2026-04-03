import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
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
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { ACPBridge } from "./acp-bridge";
import type { FelloIPCSchema } from "./ipc-schema";
import { storageOps } from "./storage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const appIconPath = join(__dirname, "../../icons/icon.iconset/icon_512x512@2x.png");

if (isDev) {
  app.commandLine.appendSwitch("no-sandbox");
  app.disableHardwareAcceleration();
}

let bridge: ACPBridge | null = null;
let activeSessionId: string | null = null;
let mainWindow: BrowserWindow | null = null;
const pendingPermissions = new Map<string, (value: RequestPermissionResponse) => void>();
const require = createRequire(import.meta.url);
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

function safeSend<K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function getKiroCliCommand() {
  return process.env.KIRO_CLI_PATH?.trim() || "kiro-cli";
}

function extractErrorMessage(error: unknown): string {
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

async function ensureBridge(cwd: string): Promise<ACPBridge> {
  if (bridge?.isConnected) return bridge;
  if (bridge) {
    await bridge.disconnect().catch(() => {});
  }
  bridge = new ACPBridge({
    command: getKiroCliCommand(),
    args: ["acp"],
    cwd,
    onSessionUpdate: (params: SessionNotification) => safeSend("session-update", params),
    onPermissionRequest: (params: RequestPermissionRequest) => {
      const toolCallId = params.toolCall.toolCallId;
      if (!mainWindow) {
        return Promise.resolve({
          outcome: { outcome: "selected", optionId: "deny" },
        } as RequestPermissionResponse);
      }
      return new Promise<RequestPermissionResponse>((resolve) => {
        pendingPermissions.set(toolCallId, resolve);
        safeSend("permission-request", params);
      });
    },
  });
  await bridge.connect();
  return bridge;
}

async function cleanupAll() {
  if (bridge) {
    await bridge.disconnect().catch(() => {});
    bridge = null;
  }
  for (const terminal of terminals.values()) {
    terminal.kill();
  }
  terminals.clear();
}

function killBridgeSync() {
  if (bridge) {
    bridge.killSync();
    bridge = null;
  }
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
    safeSend("terminal-output", { terminalId, data });
  });
  child.onExit((exitCode: number | null) => {
    terminals.delete(terminalId);
    safeSend("terminal-exit", { terminalId, exitCode });
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

const handlers: {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
} = {
  async listSessions() {
    return storageOps.listSessions();
  },

  async newSession(cwd: string) {
    const b = await ensureBridge(cwd);
    const { sessionId, models } = await b.newSession(cwd);
    activeSessionId = sessionId;
    storageOps.createSession(sessionId, cwd, `${getKiroCliCommand()} acp`);
    return { sessionId, agentInfo: b.agentInfo, models: formatModels(models) };
  },

  async loadSession({ sessionId, cwd }: { sessionId: string; cwd: string }) {
    const b = await ensureBridge(cwd);
    const models = await b.loadSession(sessionId, cwd);
    activeSessionId = sessionId;
    return { sessionId, agentInfo: b.agentInfo, models: formatModels(models) };
  },

  async sendMessage(text: string) {
    if (!bridge || !activeSessionId) throw new Error("No active session");
    storageOps.touchSession(activeSessionId);
    return await bridge.sendPrompt(activeSessionId, text);
  },

  async cancelPrompt() {
    if (bridge && activeSessionId) await bridge.cancel(activeSessionId);
  },

  async respondPermission({ toolCallId, optionId }: { toolCallId: string; optionId: string }) {
    const resolve = pendingPermissions.get(toolCallId);
    if (resolve && optionId) {
      resolve({ outcome: { outcome: "selected", optionId } });
      pendingPermissions.delete(toolCallId);
    }
  },

  async updateSessionTitle({ sessionId, title }: { sessionId: string; title: string }) {
    storageOps.updateSessionTitle(sessionId, title);
  },

  async changeWorkDir({ sessionId }: { sessionId: string }) {
    try {
      const result = await dialog.showOpenDialog({
        defaultPath: homedir(),
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, cwd: null };
      }
      const newCwd = result.filePaths[0];
      const b = await ensureBridge(newCwd);
      await b.loadSession(sessionId, newCwd);
      activeSessionId = sessionId;
      storageOps.updateSessionCwd(sessionId, newCwd);
      return { ok: true, cwd: newCwd };
    } catch {
      return { ok: false, cwd: null };
    }
  },

  async deleteSession(sessionId: string) {
    storageOps.deleteSession(sessionId);
    if (activeSessionId === sessionId) activeSessionId = null;
  },

  async disconnect() {
    await cleanupAll();
    activeSessionId = null;
  },

  async getCwd() {
    return process.cwd();
  },

  async pickWorkDir() {
    const result = await dialog.showOpenDialog({
      defaultPath: homedir(),
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  },

  async getModels() {
    if (!bridge || !activeSessionId) return null;
    return formatModels(bridge.getModelState(activeSessionId));
  },

  async setModel(modelId: string) {
    if (!bridge || !activeSessionId) throw new Error("No active session");
    await bridge.setSessionModel(activeSessionId, modelId);
  },

  async searchFiles({ cwd, query }: { cwd: string; query?: string }) {
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

  async readDir({ path: dirPath, depth = 1 }: { path: string; depth?: number }) {
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

  async createFile({ path, isFolder }: { path: string; isFolder: boolean }) {
    if (isFolder) {
      await mkdir(path, { recursive: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
    }
  },

  async deleteFile({ path, permanent }: { path: string; permanent: boolean }) {
    if (permanent) {
      await rm(path, { recursive: true, force: true });
      return;
    }
    try {
      await shell.trashItem(path);
    } catch {
      await rm(path, { recursive: true, force: true });
    }
  },

  async getPlatform() {
    return process.platform;
  },

  async renameFile({ oldPath, newPath }: { oldPath: string; newPath: string }) {
    await rename(oldPath, newPath);
  },

  async moveFile({ oldPath, newPath }: { oldPath: string; newPath: string }) {
    await rename(oldPath, newPath);
  },

  async readFile(filePath: string) {
    return fsReadFile(filePath, "utf-8");
  },

  async revealInFinder(filePath: string) {
    shell.showItemInFolder(filePath);
  },

  async writeDroppedFile({
    fileName,
    base64,
    destDir,
  }: {
    fileName: string;
    base64: string;
    destDir: string;
  }) {
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

  async writeDroppedFolder({ destDir }: { destDir: string }) {
    await mkdir(destDir, { recursive: true });
  },

  async showContextMenu({
    items,
  }: {
    items: Array<{
      label?: string;
      action?: string;
      type?: string;
      enabled?: boolean;
      data?: unknown;
    }>;
  }) {
    if (!mainWindow) return null;
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const settle = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const window = mainWindow;
      if (!window) {
        settle(null);
        return;
      }

      const menu = Menu.buildFromTemplate(
        items.map((item) => {
          if (item.type === "separator") return { type: "separator" as const };
          return {
            label: item.label ?? "",
            enabled: item.enabled ?? true,
            click: () => settle(item.action ?? null),
          };
        }),
      );

      menu.popup({
        window,
        callback: () => settle(null),
      });
    });
  },

  async createTerminal({
    sessionId,
    cwd: requestedCwd,
    cols,
    rows,
  }: {
    sessionId: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }) {
    const session = storageOps.getSession(sessionId);
    const cwd = requestedCwd?.trim() || session?.cwd?.trim() || "";
    if (!cwd) {
      throw new Error(`Failed to create terminal: missing cwd for session ${sessionId}`);
    }
    return { terminalId: await createTerminalProcess(cwd, { cols, rows }) };
  },

  async writeTerminal({ terminalId, data }: { terminalId: string; data: string }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.write(data);
    return { ok: true };
  },

  async killTerminal({ terminalId }: { terminalId: string }) {
    const terminal = terminals.get(terminalId);
    if (!terminal) return { ok: false };
    terminal.kill();
    terminals.delete(terminalId);
    return { ok: true };
  },

  async resizeTerminal({
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
  },
};

function registerHandler<K extends keyof FelloIPCSchema["requests"]>(channel: K) {
  ipcMain.handle(
    channel,
    async (_event: unknown, params: FelloIPCSchema["requests"][K]["params"]) => {
      try {
        return await handlers[channel](params);
      } catch (error) {
        throw new Error(extractErrorMessage(error));
      }
    },
  );
}

function setupMenu() {
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    ...(isDev
      ? [
          {
            label: "View",
            submenu: [{ role: "toggleDevTools" }],
          },
        ]
      : []),
    {
      label: "Window",
      submenu: [{ role: "close" }, { role: "minimize" }, { role: "zoom" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template as any));
}

function createMainWindow() {
  const win = new BrowserWindow({
    title: "Fello",
    width: 1100,
    height: 800,
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev) {
    win.webContents.on("console-message", (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    win.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.error("[did-fail-load]", {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
        });
      },
    );
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error("[render-process-gone]", details);
    });
    win.webContents.on("did-finish-load", async () => {
      const preloadState = await win.webContents
        .executeJavaScript("typeof window.fello")
        .catch((error) => `error:${String(error)}`);
      const htmlLength = await win.webContents
        .executeJavaScript("document.body?.innerHTML?.length ?? 0")
        .catch(() => -1);
      console.log("[did-finish-load]", {
        url: win.webContents.getURL(),
        preloadState,
        htmlLength,
      });
    });
  }

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

for (const channel of Object.keys(handlers) as Array<keyof FelloIPCSchema["requests"]>) {
  registerHandler(channel);
}

app.on("before-quit", () => {
  killBridgeSync();
});

app.whenReady().then(() => {
  const dockIcon = nativeImage.createFromPath(appIconPath);
  if (!dockIcon.isEmpty() && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(dockIcon);
  }
  setupMenu();
  createMainWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
