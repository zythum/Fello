import Electrobun, {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
  ContextMenu,
  Updater,
  Utils,
} from "electrobun/bun";
import { ACPBridge } from "./acp-bridge";
import { storageOps } from "./storage";
import type { FelloRPCSchema } from "./rpc-schema";
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { homedir } from "os";
import { readdir, stat, mkdir, writeFile, rm, rename, readFile as fsReadFile } from "fs/promises";
import { join, dirname, relative } from "path";
import Fuse from "fuse.js";
import { exec } from "child_process";
import { platform } from "os";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

let pendingContextMenuCleanup: (() => void) | null = null;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log("Vite dev server not running.");
    }
  }
  return "views://mainview/index.html";
}

// --- State ---
let bridge: ACPBridge | null = null;
let activeSessionId: string | null = null;
let mainWindowId: number | null = null;
const pendingPermissions = new Map<string, (value: RequestPermissionResponse) => void>();

/** Safe RPC call — silently drops if no window is open */
function safeRpcCall(fn: () => void) {
  if (mainWindowId === null) return;
  try {
    fn();
  } catch (e) {
    console.warn("[Fello] RPC call failed (window may be closed):", e);
  }
}

async function ensureBridge(cwd: string): Promise<ACPBridge> {
  if (bridge?.isConnected) return bridge;
  // Disconnect stale bridge if any
  if (bridge) {
    await bridge.disconnect().catch(() => {});
  }
  bridge = new ACPBridge({
    command: "/Users/zhuyi/.local/bin/kiro-cli",
    args: ["acp"],
    cwd,
    onSessionUpdate: (params: SessionNotification) => {
      safeRpcCall(() => rpc.request.onSessionUpdate(JSON.stringify(params)));
    },
    onPermissionRequest: (params: RequestPermissionRequest) => {
      const toolCallId = params.toolCall.toolCallId;
      if (mainWindowId === null) {
        return Promise.resolve({
          outcome: { outcome: "selected", optionId: "deny" },
        } as RequestPermissionResponse);
      }
      return new Promise<RequestPermissionResponse>((resolve) => {
        pendingPermissions.set(toolCallId, resolve);
        safeRpcCall(() => rpc.request.onPermissionRequest(JSON.stringify(params)));
      });
    },
  });
  await bridge.connect();
  return bridge;
}

// --- Cleanup on exit ---
async function cleanupAll() {
  console.log("[Fello] Cleaning up bridge...");
  if (bridge) {
    await bridge.disconnect().catch((e) => console.error("[Fello] cleanup error:", e));
    bridge = null;
  }
}

/** Synchronously kill the child process (for use in before-quit where we can't await) */
function killBridgeSync() {
  if (bridge) {
    bridge.killSync();
    bridge = null;
  }
}

// Electrobun before-quit: runs synchronously before forceExit
Electrobun.events.on("before-quit", () => {
  console.log("[Fello] before-quit: killing bridge process...");
  killBridgeSync();
});

process.on("exit", () => {
  cleanupAll();
});
process.on("SIGINT", async () => {
  await cleanupAll();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await cleanupAll();
  process.exit(0);
});

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

// --- RPC Handlers ---
const handlers = {
  async listSessions() {
    return storageOps.listSessions();
  },

  async newChat(cwd: string) {
    try {
      const b = await ensureBridge(cwd);
      const { sessionId, models: _models } = await b.createSession(cwd);
      activeSessionId = sessionId;
      storageOps.createSession(sessionId, cwd, "kiro-cli acp");
      return { sessionId, agentInfo: b.agentInfo };
    } catch (err) {
      console.error("[newChat] failed:", err);
      throw err;
    }
  },

  async resumeChat({ sessionId, cwd }: { sessionId: string; cwd: string }) {
    try {
      const b = await ensureBridge(cwd);
      // Always call resumeSession so the ACP agent re-loads the session
      // (e.g. after the window was closed and reopened via dock icon).
      const models = await b.resumeSession(sessionId, cwd);
      activeSessionId = sessionId;
      return { ok: true, models: formatModels(models) };
    } catch (err) {
      console.error("[resumeChat] failed:", err);
      return { ok: false, models: null };
    }
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
      const paths = await Utils.openFileDialog({
        startingFolder: homedir(),
        canChooseFiles: false,
        canChooseDirectory: true,
        allowsMultipleSelection: false,
      });
      if (!paths || paths.length === 0 || paths[0] === "") {
        return { ok: false, cwd: null };
      }
      const newCwd = paths[0];
      const b = await ensureBridge(newCwd);
      await b.resumeSession(sessionId, newCwd);
      activeSessionId = sessionId;
      storageOps.updateSessionCwd(sessionId, newCwd);
      return { ok: true, cwd: newCwd };
    } catch (err) {
      console.error("[changeWorkDir] failed:", err);
      return { ok: false, cwd: null };
    }
  },

  async deleteSession(sessionId: string) {
    storageOps.deleteSession(sessionId);
    if (activeSessionId === sessionId) {
      activeSessionId = null;
    }
  },

  async disconnect() {
    await cleanupAll();
    activeSessionId = null;
  },

  async getCwd() {
    return process.cwd();
  },

  async pickWorkDir() {
    const paths = await Utils.openFileDialog({
      startingFolder: homedir(),
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
    if (!paths || paths.length === 0 || paths[0] === "") return null;
    return paths[0];
  },

  async getModels() {
    if (!bridge || !activeSessionId) return null;
    const state = bridge.getModelState(activeSessionId);
    return formatModels(state);
  },

  async setModel(modelId: string) {
    if (!bridge || !activeSessionId) throw new Error("No active session");
    await bridge.setModel(activeSessionId, modelId);
  },

  async searchFiles({ cwd, query }: { cwd: string; query?: string }) {
    const IGNORE = new Set([
      "node_modules",
      ".git",
      ".DS_Store",
      "dist",
      "build",
      ".next",
      ".cache",
      "__pycache__",
      ".vscode",
    ]);

    const MAX_RESULTS = 10;

    // No query or empty: return top-level entries
    if (!query || query.trim() === "") {
      const entries = await readdir(cwd).catch(() => []);
      const results: Array<{ id: string; display: string }> = [];
      for (const name of entries) {
        if (IGNORE.has(name)) continue;
        const full = join(cwd, name);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        results.push({ id: full, display: name });
        if (results.length >= MAX_RESULTS) break;
      }
      results.sort((a, b) => a.display.localeCompare(b.display));
      return results;
    }

    // Collect all files recursively for fuzzy search
    const allFiles: Array<{ id: string; display: string }> = [];

    async function collect(dir: string) {
      const entries = await readdir(dir).catch(() => []);
      for (const name of entries) {
        if (IGNORE.has(name)) continue;
        const full = join(dir, name);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        const rel = relative(cwd, full);
        allFiles.push({ id: full, display: rel });
        if (s.isDirectory()) {
          await collect(full);
        }
      }
    }

    await collect(cwd);

    const fuse = new Fuse(allFiles, {
      keys: ["display"],
      threshold: 0.4,
    });

    return fuse.search(query, { limit: MAX_RESULTS }).map((r) => r.item);
  },

  async readDir({ path: dirPath, depth = 1 }: { path: string; depth?: number }) {
    const IGNORE = new Set([
      "node_modules",
      ".git",
      ".DS_Store",
      "dist",
      "build",
      ".next",
      ".cache",
      "__pycache__",
      ".vscode",
    ]);

    async function walk(p: string, d: number): Promise<unknown[]> {
      const entries = await readdir(p).catch(() => []);
      const results: unknown[] = [];
      for (const name of entries) {
        if (IGNORE.has(name)) continue;
        const full = join(p, name);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        if (s.isDirectory()) {
          const children = d > 1 ? await walk(full, d - 1) : [];
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

    return await walk(dirPath, depth);
  },

  async createFile({ path: filePath, isFolder }: { path: string; isFolder: boolean }) {
    if (isFolder) {
      await mkdir(filePath, { recursive: true });
    } else {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, "");
    }
  },

  async deleteFile({ path: filePath, permanent }: { path: string; permanent: boolean }) {
    if (permanent) {
      await rm(filePath, { recursive: true, force: true });
      return;
    }
    const os = platform();
    const escaped = filePath.replace(/"/g, '\\"');
    if (os === "darwin") {
      await new Promise<void>((resolve, reject) => {
        exec(`osascript -e 'tell application "Finder" to delete POSIX file "${escaped}"'`, (err) =>
          err ? reject(err) : resolve(),
        );
      });
    } else if (os === "win32") {
      // PowerShell: use Shell.Application to move to Recycle Bin
      const ps = `$shell = New-Object -ComObject Shell.Application; $item = $shell.NameSpace(0).ParseName("${escaped}"); $item.InvokeVerb("delete")`;
      await new Promise<void>((resolve, reject) => {
        exec(`powershell -Command "${ps}"`, (err) => (err ? reject(err) : resolve()));
      });
    } else {
      // Linux: try gio trash, fall back to trash-cli, then permanent delete
      await new Promise<void>((resolve, reject) => {
        exec(`gio trash "${escaped}"`, (err) => {
          if (!err) return resolve();
          exec(`trash-put "${escaped}"`, (err2) => {
            if (!err2) return resolve();
            rm(filePath, { recursive: true, force: true }).then(resolve, reject);
          });
        });
      });
    }
  },

  async getPlatform() {
    return platform();
  },

  async renameFile({ oldPath, newPath }: { oldPath: string; newPath: string }) {
    await rename(oldPath, newPath);
  },

  async moveFile({ oldPath, newPath }: { oldPath: string; newPath: string }) {
    await rename(oldPath, newPath);
  },

  async readFile(filePath: string) {
    return await fsReadFile(filePath, "utf-8");
  },

  async revealInFinder(filePath: string) {
    exec(`open -R "${filePath}"`);
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

    // Avoid overwriting: append (n) suffix if target exists
    const s = await stat(dest).catch(() => null);
    if (s) {
      const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
      const base = ext ? fileName.slice(0, -ext.length) : fileName;
      let i = 1;
      while (await stat(join(destDir, `${base} (${i})${ext}`)).catch(() => null)) i++;
      dest = join(destDir, `${base} (${i})${ext}`);
    }

    const buf = Buffer.from(base64, "base64");
    await writeFile(dest, buf);
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
    // Cancel any previously pending context menu
    if (pendingContextMenuCleanup) {
      pendingContextMenuCleanup();
      pendingContextMenuCleanup = null;
    }

    return new Promise<string | null>((resolve) => {
      let settled = false;

      const settle = (value: string | null) => {
        if (settled) return;
        settled = true;
        Electrobun.events.off("context-menu-clicked", handler);
        pendingContextMenuCleanup = null;
        resolve(value);
      };

      const handler = (e: any) => {
        settle(e?.data?.action ?? null);
      };

      // Store cleanup so the next call can cancel this one
      pendingContextMenuCleanup = () => settle(null);

      Electrobun.events.on("context-menu-clicked", handler);
      ContextMenu.showContextMenu(items as any);
    });
  },
};

const rpc = BrowserView.defineRPC<FelloRPCSchema>({
  maxRequestTime: Infinity,
  handlers: {
    requests: handlers as any,
  },
});

// --- Application Menu ---
// macOS requires a native Edit menu for Cmd+C/V/X/A/Z to work in webviews.
ApplicationMenu.setApplicationMenu([
  {
    submenu: [
      { label: "About Fello", role: "about" },
      { type: "separator" },
      { label: "Quit Fello", role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
]);

// --- Create Window ---
const url = await getMainViewUrl();

function createMainWindow() {
  const win = new BrowserWindow({
    title: "Fello",
    url,
    rpc,
    frame: {
      width: 1100,
      height: 800,
      x: 150,
      y: 100,
    },
  });
  mainWindowId = win.id;
  win.on("close", () => {
    mainWindowId = null;
  });
  return win;
}

createMainWindow();

// macOS: reopen window when dock icon is clicked and no windows are open
Electrobun.events.on("reopen", () => {
  if (mainWindowId === null) {
    createMainWindow();
  }
});

console.log("Fello started!");
