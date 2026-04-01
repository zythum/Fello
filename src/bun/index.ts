import { BrowserWindow, BrowserView, Updater, Utils } from "electrobun/bun";
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
import { join, dirname } from "path";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

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
const pendingPermissions = new Map<string, (value: RequestPermissionResponse) => void>();

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
      rpc.request.onSessionUpdate(JSON.stringify(params));
    },
    onPermissionRequest: (params: RequestPermissionRequest) => {
      const toolCallId = params.toolCall.toolCallId;
      return new Promise<RequestPermissionResponse>((resolve) => {
        pendingPermissions.set(toolCallId, resolve);
        rpc.request.onPermissionRequest(JSON.stringify(params));
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
      // If bridge already knows this session, just switch
      const existingModels = b.getModelState(sessionId);
      if (existingModels) {
        activeSessionId = sessionId;
        return { ok: true, models: formatModels(existingModels) };
      }
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

  async deleteFile(filePath: string) {
    await rm(filePath, { recursive: true, force: true });
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
};

const rpc = BrowserView.defineRPC<FelloRPCSchema>({
  maxRequestTime: Infinity,
  handlers: {
    requests: handlers as any,
  },
});

// --- Create Window ---
const url = await getMainViewUrl();

new BrowserWindow({
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

console.log("Fello started!");
