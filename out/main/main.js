import { app, nativeImage, BrowserWindow, shell, dialog, ipcMain, Menu } from "electron";
import Fuse from "fuse.js";
import { homedir } from "os";
import { mkdir, stat, writeFile, readFile, rename, rm, readdir } from "fs/promises";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { Writable, Readable } from "stream";
import * as acp from "@agentclientprotocol/sdk";
import { mkdirSync, existsSync, readdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
class ACPBridge {
  constructor(options) {
    this.options = options;
    this.onSessionUpdate = options.onSessionUpdate;
    this.onPermissionRequest = options.onPermissionRequest;
  }
  options;
  process = null;
  connection = null;
  onSessionUpdate;
  onPermissionRequest;
  _isConnected = false;
  _agentInfo = null;
  _modelStates = /* @__PURE__ */ new Map();
  get isConnected() {
    return this._isConnected;
  }
  get agentInfo() {
    return this._agentInfo;
  }
  getModelState(sessionId) {
    return this._modelStates.get(sessionId) ?? null;
  }
  async connect() {
    const proc = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: this.options.cwd,
      detached: true
    });
    proc.unref();
    this.process = proc;
    const input = Writable.toWeb(proc.stdin);
    const output = Readable.toWeb(proc.stdout);
    const rawStream = acp.ndJsonStream(input, output);
    const logReadable = rawStream.readable.pipeThrough(
      new TransformStream({
        transform(msg, controller) {
          console.log("[ACP ←]", JSON.stringify(msg));
          controller.enqueue(msg);
        }
      })
    );
    const rawWriter = rawStream.writable.getWriter();
    const logWritable = new WritableStream({
      async write(msg) {
        console.log("[ACP →]", JSON.stringify(msg));
        try {
          await rawWriter.write(msg);
        } catch {
        }
      },
      async close() {
        try {
          rawWriter.releaseLock();
        } catch {
        }
      }
    });
    const stream = { readable: logReadable, writable: logWritable };
    const onPermission = this.onPermissionRequest;
    const onUpdate = this.onSessionUpdate;
    const client = {
      async requestPermission(params) {
        return onPermission(params);
      },
      async sessionUpdate(params) {
        onUpdate(params);
      },
      async writeTextFile(params) {
        const { writeFile: writeFile2 } = await import("fs/promises");
        await writeFile2(params.path, "");
        return {};
      },
      async readTextFile(params) {
        const { readFile: readFile2 } = await import("fs/promises");
        const content = await readFile2(params.path, "utf-8");
        return { content };
      },
      async extNotification(_method, _params) {
      }
    };
    this.connection = new acp.ClientSideConnection((_agent) => client, stream);
    const initResult = await this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: { name: "Fello", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true }
      }
    });
    this._isConnected = true;
    this._agentInfo = initResult;
    console.log("[ACP] agent capabilities:", JSON.stringify(initResult, null, 2));
    return initResult;
  }
  async createSession(cwd) {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.newSession({
      cwd,
      mcpServers: []
    });
    const models = result.models ?? null;
    if (models) this._modelStates.set(result.sessionId, models);
    return { sessionId: result.sessionId, models };
  }
  async setModel(sessionId, modelId) {
    if (!this.connection) throw new Error("Not connected");
    await this.connection.unstable_setSessionModel({ sessionId, modelId });
    const state = this._modelStates.get(sessionId);
    if (state) {
      state.currentModelId = modelId;
    }
  }
  async resumeSession(sessionId, cwd) {
    if (!this.connection) throw new Error("Not connected");
    const result = await this.connection.loadSession({
      sessionId,
      cwd,
      mcpServers: []
    });
    const models = result.models ?? null;
    if (models) this._modelStates.set(sessionId, models);
    return models;
  }
  async sendPrompt(sessionId, text) {
    if (!this.connection) throw new Error("Not connected");
    return this.connection.prompt({
      sessionId,
      prompt: [{ type: "text", text }]
    });
  }
  async cancel(sessionId) {
    if (!this.connection) return;
    await this.connection.cancel({ sessionId });
  }
  async disconnect() {
    if (this.connection && this._isConnected) {
      const sessionIds = [...this._modelStates.keys()];
      for (const sid of sessionIds) {
        try {
          await this.connection.unstable_closeSession({ sessionId: sid });
        } catch {
        }
      }
    }
    this._isConnected = false;
    this._modelStates.clear();
    this.connection = null;
    if (this.process) {
      const proc = this.process;
      this.process = null;
      try {
        proc.stdin?.end();
      } catch {
      }
      await new Promise((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.on("exit", () => resolve());
        setTimeout(() => {
          this.killProcessGroup(proc, "SIGTERM");
          setTimeout(() => {
            this.killProcessGroup(proc, "SIGKILL");
            resolve();
          }, 2e3);
        }, 3e3);
      });
    }
  }
  killSync() {
    this._isConnected = false;
    this._modelStates.clear();
    this.connection = null;
    if (this.process) {
      const proc = this.process;
      this.process = null;
      try {
        proc.stdin?.end();
      } catch {
      }
      this.killProcessGroup(proc, "SIGTERM");
    }
  }
  killProcessGroup(proc, signal) {
    const pid = proc.pid;
    if (pid == null) return;
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
      }
    }
  }
}
const DATA_DIR = join(homedir(), ".fello");
const SESSIONS_DIR = join(DATA_DIR, "sessions");
mkdirSync(SESSIONS_DIR, { recursive: true });
function sessionDir(id) {
  return join(SESSIONS_DIR, id);
}
function metaPath(id) {
  return join(sessionDir(id), "meta.json");
}
function readMeta(id) {
  try {
    return JSON.parse(readFileSync(metaPath(id), "utf-8"));
  } catch {
    return null;
  }
}
function writeMeta(meta) {
  mkdirSync(sessionDir(meta.id), { recursive: true });
  writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}
const storageOps = {
  createSession(id, cwd, agentCommand) {
    const now = Math.floor(Date.now() / 1e3);
    writeMeta({ id, title: "New Chat", cwd, agentCommand, createdAt: now, updatedAt: now });
  },
  updateSessionTitle(id, title) {
    const meta = readMeta(id);
    if (!meta) return;
    meta.title = title;
    meta.updatedAt = Math.floor(Date.now() / 1e3);
    writeMeta(meta);
  },
  updateSessionCwd(id, cwd) {
    const meta = readMeta(id);
    if (!meta) return;
    meta.cwd = cwd;
    meta.updatedAt = Math.floor(Date.now() / 1e3);
    writeMeta(meta);
  },
  deleteSession(id) {
    const dir = sessionDir(id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  },
  listSessions() {
    if (!existsSync(SESSIONS_DIR)) return [];
    const dirs = readdirSync(SESSIONS_DIR);
    const sessions = [];
    for (const d of dirs) {
      const meta = readMeta(d);
      if (meta) sessions.push(meta);
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      cwd: s.cwd,
      agent_command: s.agentCommand,
      created_at: s.createdAt,
      updated_at: s.updatedAt
    }));
  },
  touchSession(id) {
    const meta = readMeta(id);
    if (!meta) return;
    meta.updatedAt = Math.floor(Date.now() / 1e3);
    writeMeta(meta);
  }
};
const __dirname$1 = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const appIconPath = join(__dirname$1, "../../icons/icon.iconset/icon_512x512@2x.png");
if (isDev) {
  app.commandLine.appendSwitch("no-sandbox");
  app.disableHardwareAcceleration();
}
let bridge = null;
let activeSessionId = null;
let mainWindow = null;
const pendingPermissions = /* @__PURE__ */ new Map();
function safeSend(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}
function getKiroCliCommand() {
  return process.env.KIRO_CLI_PATH?.trim() || "kiro-cli";
}
async function ensureBridge(cwd) {
  if (bridge?.isConnected) return bridge;
  if (bridge) {
    await bridge.disconnect().catch(() => {
    });
  }
  bridge = new ACPBridge({
    command: getKiroCliCommand(),
    args: ["acp"],
    cwd,
    onSessionUpdate: (params) => safeSend("session-update", params),
    onPermissionRequest: (params) => {
      const toolCallId = params.toolCall.toolCallId;
      if (!mainWindow) {
        return Promise.resolve({
          outcome: { outcome: "selected", optionId: "deny" }
        });
      }
      return new Promise((resolve) => {
        pendingPermissions.set(toolCallId, resolve);
        safeSend("permission-request", params);
      });
    }
  });
  await bridge.connect();
  return bridge;
}
async function cleanupAll() {
  if (bridge) {
    await bridge.disconnect().catch(() => {
    });
    bridge = null;
  }
}
function killBridgeSync() {
  if (bridge) {
    bridge.killSync();
    bridge = null;
  }
}
function formatModels(models) {
  if (!models) return null;
  return {
    availableModels: models.availableModels.map((m) => ({
      modelId: m.modelId,
      name: m.name,
      description: m.description ?? null
    })),
    currentModelId: models.currentModelId
  };
}
const handlers = {
  async listSessions() {
    return storageOps.listSessions();
  },
  async newChat(cwd) {
    const b = await ensureBridge(cwd);
    const { sessionId } = await b.createSession(cwd);
    activeSessionId = sessionId;
    storageOps.createSession(sessionId, cwd, `${getKiroCliCommand()} acp`);
    return { sessionId, agentInfo: b.agentInfo };
  },
  async resumeChat({ sessionId, cwd }) {
    try {
      const b = await ensureBridge(cwd);
      const models = await b.resumeSession(sessionId, cwd);
      activeSessionId = sessionId;
      return { ok: true, models: formatModels(models) };
    } catch {
      return { ok: false, models: null };
    }
  },
  async sendMessage(text) {
    if (!bridge || !activeSessionId) throw new Error("No active session");
    storageOps.touchSession(activeSessionId);
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
  async changeWorkDir({ sessionId }) {
    try {
      const result = await dialog.showOpenDialog({
        defaultPath: homedir(),
        properties: ["openDirectory"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, cwd: null };
      }
      const newCwd = result.filePaths[0];
      const b = await ensureBridge(newCwd);
      await b.resumeSession(sessionId, newCwd);
      activeSessionId = sessionId;
      storageOps.updateSessionCwd(sessionId, newCwd);
      return { ok: true, cwd: newCwd };
    } catch {
      return { ok: false, cwd: null };
    }
  },
  async deleteSession(sessionId) {
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
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  },
  async getModels() {
    if (!bridge || !activeSessionId) return null;
    return formatModels(bridge.getModelState(activeSessionId));
  },
  async setModel(modelId) {
    if (!bridge || !activeSessionId) throw new Error("No active session");
    await bridge.setModel(activeSessionId, modelId);
  },
  async searchFiles({ cwd, query }) {
    const ignore = /* @__PURE__ */ new Set([
      "node_modules",
      ".git",
      ".DS_Store",
      "dist",
      "build",
      ".next",
      ".cache",
      "__pycache__",
      ".vscode",
      "out"
    ]);
    const maxResults = 10;
    if (!query || query.trim() === "") {
      const entries = await readdir(cwd).catch(() => []);
      const results = [];
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
    const allFiles = [];
    async function collect(dir) {
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
      threshold: 0.4
    });
    return fuse.search(query, { limit: maxResults }).map((result) => result.item);
  },
  async readDir({ path: dirPath, depth = 1 }) {
    const ignore = /* @__PURE__ */ new Set([
      "node_modules",
      ".git",
      ".DS_Store",
      "dist",
      "build",
      ".next",
      ".cache",
      "__pycache__",
      ".vscode",
      "out"
    ]);
    async function walk(path, currentDepth) {
      const entries = await readdir(path).catch(() => []);
      const results = [];
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
      results.sort((a, b) => {
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
  async deleteFile({ path, permanent }) {
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
  async renameFile({ oldPath, newPath }) {
    await rename(oldPath, newPath);
  },
  async moveFile({ oldPath, newPath }) {
    await rename(oldPath, newPath);
  },
  async readFile(filePath) {
    return readFile(filePath, "utf-8");
  },
  async revealInFinder(filePath) {
    shell.showItemInFolder(filePath);
  },
  async writeDroppedFile({
    fileName,
    base64,
    destDir
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
  async writeDroppedFolder({ destDir }) {
    await mkdir(destDir, { recursive: true });
  },
  async showContextMenu({
    items
  }) {
    if (!mainWindow) return null;
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
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
          if (item.type === "separator") return { type: "separator" };
          return {
            label: item.label ?? "",
            enabled: item.enabled ?? true,
            click: () => settle(item.action ?? null)
          };
        })
      );
      menu.popup({
        window,
        callback: () => settle(null)
      });
    });
  }
};
function registerHandler(channel) {
  ipcMain.handle(
    channel,
    (_event, params) => handlers[channel](params)
  );
}
function setupMenu() {
  const template = [
    ...process.platform === "darwin" ? [
      {
        label: app.name,
        submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }]
      }
    ] : [],
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
        { role: "selectAll" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function createMainWindow() {
  const win = new BrowserWindow({
    title: "Fello",
    width: 1100,
    height: 800,
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname$1, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
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
          isMainFrame
        });
      }
    );
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error("[render-process-gone]", details);
    });
    win.webContents.on("did-finish-load", async () => {
      const preloadState = await win.webContents.executeJavaScript("typeof window.fello").catch((error) => `error:${String(error)}`);
      const htmlLength = await win.webContents.executeJavaScript("document.body?.innerHTML?.length ?? 0").catch(() => -1);
      console.log("[did-finish-load]", {
        url: win.webContents.getURL(),
        preloadState,
        htmlLength
      });
      win.webContents.openDevTools({ mode: "detach" });
    });
  }
  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname$1, "../renderer/index.html"));
  }
  return win;
}
for (const channel of Object.keys(handlers)) {
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
