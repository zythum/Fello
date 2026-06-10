import "./env";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  nativeTheme,
  MenuItemConstructorOptions,
} from "electron";
import electronUpdater from "electron-updater";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  backendHandlers,
  initBackend,
  clearBackend,
  type FelloIPCSchema,
} from "../backend/backend";
import { extractErrorMessage } from "../backend/utils";
import { storageOps } from "../backend/storage";
import { serveProjectFile } from "../backend/serve-project-file";
import {
  createAutoUpdateCheckGate,
  createUpdaterEvent,
  createUpdaterProgressEvent,
  normalizeUpdaterInfo,
  type UpdaterEvent,
} from "./updater";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const { autoUpdater } = electronUpdater;

if (isDev) {
  app.commandLine.appendSwitch("no-sandbox");
  // app.disableHardwareAcceleration();
}

// Register the custom `web://` scheme as privileged before app is ready.
// This enables standard URL parsing, fetch support, and CORS in iframes.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "web",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

function safeSend<K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send(channel, payload);
  return true;
}

initBackend(safeSend);

for (const channel of Object.keys(backendHandlers) as Array<keyof FelloIPCSchema["requests"]>) {
  ipcMain.handle(
    channel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (event: Electron.IpcMainInvokeEvent, params: any) => {
      try {
        if (channel === "registerClient") {
          const wc = event.sender;
          const clientId = params.clientId;

          let isCleaned = false;
          const doCleanup = () => {
            if (isCleaned) return;
            isCleaned = true;
            void backendHandlers.killTerminalsByClient({ clientId });
            wc.removeListener("destroyed", doCleanup);
            wc.removeListener("did-start-navigation", onNavigation);
            wc.removeListener("render-process-gone", doCleanup);
          };

          const onNavigation = (
            _e: Electron.Event,
            _url: string,
            isInPlace: boolean,
            isMainFrame: boolean,
          ) => {
            if (isMainFrame && !isInPlace) {
              doCleanup();
            }
          };

          wc.once("destroyed", doCleanup);
          wc.on("did-start-navigation", onNavigation);
          wc.once("render-process-gone", doCleanup);
        }
        return await (backendHandlers as any)[channel](params);
      } catch (error) {
        throw new Error(extractErrorMessage(error));
      }
    },
  );
}

// Register Electron-specific APIs
ipcMain.handle("showOpenDialog", async () => {
  try {
    const result = await dialog.showOpenDialog({
      defaultPath: homedir(),
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
});

ipcMain.handle("revealInFinder", async (_event: unknown, filePath: string) => {
  try {
    shell.showItemInFolder(filePath);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
});

ipcMain.handle("openInBrowser", async (_event: unknown, url: string) => {
  try {
    await shell.openExternal(url);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
});

ipcMain.handle("trashFile", async (_event: unknown, path: string) => {
  try {
    await shell.trashItem(path);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
});

const autoUpdateCheckGate = createAutoUpdateCheckGate();
let lastUpdaterEvent: UpdaterEvent | null = null;
let lastUpdateCheckManual = false;
let isUpdateChecking = false;
let isUpdateDownloading = false;
let hasDownloadedUpdate = false;
let isInstallingUpdate = false;
function sendUpdaterEvent(event: UpdaterEvent) {
  lastUpdaterEvent = event;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send("electron:updater-event", event);
}

ipcMain.handle("getUpdaterStatus", () => lastUpdaterEvent);

ipcMain.handle("checkForUpdates", async (_event: unknown, params?: { manual?: boolean }) => {
  await checkForUpdates({ manual: Boolean(params?.manual) });
});

ipcMain.handle("downloadUpdate", async () => {
  await downloadAvailableUpdate();
});

ipcMain.handle("installUpdate", async () => {
  await installDownloadedUpdate();
});

function isUpdaterEnabled() {
  return !isDev && app.isPackaged;
}

async function checkForUpdates({ manual }: { manual: boolean }) {
  if (!autoUpdateCheckGate.shouldStart(manual)) return;

  if (isDev || !app.isPackaged) {
    console.log("[checkForUpdates] skipped in dev mode");
    sendUpdaterEvent({
      type: "disabled",
      manual,
      reason: "Updates are available only in packaged builds.",
    });
    return;
  }

  if (isUpdateChecking) return;

  lastUpdateCheckManual = manual;
  isUpdateChecking = true;
  sendUpdaterEvent({ type: "checking", manual });

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    isUpdateChecking = false;
    lastUpdateCheckManual = false;
    sendUpdaterEvent({
      type: "error",
      manual,
      message: extractErrorMessage(error),
    });
    throw new Error(extractErrorMessage(error));
  }
}

async function downloadAvailableUpdate() {
  if (!isUpdaterEnabled()) {
    throw new Error("Updates are available only in packaged builds.");
  }
  if (isUpdateDownloading || hasDownloadedUpdate) return;
  if (lastUpdaterEvent?.type !== "available") {
    const message = "No update is ready to download.";
    sendUpdaterEvent({ type: "error", manual: true, message });
    throw new Error(message);
  }

  isUpdateDownloading = true;
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    isUpdateDownloading = false;
    sendUpdaterEvent({
      type: "error",
      manual: true,
      message: extractErrorMessage(error),
    });
    throw new Error(extractErrorMessage(error));
  }
}

async function installDownloadedUpdate() {
  if (!hasDownloadedUpdate) {
    throw new Error("No downloaded update is ready to install.");
  }

  isInstallingUpdate = true;
  await clearBackend().catch(() => {});
  autoUpdater.quitAndInstall(false, true);
}

function setupMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "quit" },
            ] satisfies MenuItemConstructorOptions[],
          },
        ] satisfies MenuItemConstructorOptions[])
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
      ] satisfies MenuItemConstructorOptions[],
    },
    {
      label: "Window",
      submenu: [
        { role: "close" },
        { role: "minimize" },
        { role: "zoom" },
      ] satisfies MenuItemConstructorOptions[],
    },
    {
      label: "Help",
      submenu: [
        { role: "toggleDevTools" },
        { label: "Check for Updates...", click: () => void checkForUpdates({ manual: true }) },
        { type: "separator" },
        {
          label: "Fello on GitHub",
          click: () => void shell.openExternal("https://github.com/Zythum/fello"),
        },
      ] satisfies MenuItemConstructorOptions[],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  const settings = storageOps.getSettings();
  const themeMode = settings.theme?.themeMode || "system";
  const isDark =
    themeMode === "dark" || (themeMode === "system" && nativeTheme.shouldUseDarkColors);
  const backgroundColor = isDark ? "#09090b" : "#ffffff";

  const win = new BrowserWindow({
    title: "Fello",
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 100,
    backgroundColor,
    show: false, // Don't show until ready-to-show
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden",
          trafficLightPosition: {
            x: 14,
            y: 15,
          },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../scripts/electron-preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.platform === "darwin") {
    win.on("enter-full-screen", () => {
      win.webContents.send("electron:mac-fullscreen", true);
    });
    win.on("leave-full-screen", () => {
      win.webContents.send("electron:mac-fullscreen", false);
    });
  }

  win.once("ready-to-show", () => {
    win.show();
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // 1. 处理当前窗口内的跳转（如 <a href="...">）
  win.webContents.on("will-navigate", (event, url) => {
    // 排除开发环境下的 Vite Dev Server URL
    if (
      isDev &&
      process.env.ELECTRON_RENDERER_URL &&
      url.startsWith(process.env.ELECTRON_RENDERER_URL)
    ) {
      return;
    }

    // 如果是外部链接（根据你的业务逻辑判断，比如不是 localhost）
    if (url.startsWith("http:") || url.startsWith("https:")) {
      event.preventDefault(); // 阻止 Electron 内部跳转
      shell.openExternal(url); // 调用系统浏览器打开
    }
  });

  // 2. 处理 target="_blank" 或 window.open 打开的新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 排除开发环境下的 Vite Dev Server URL
    if (
      isDev &&
      process.env.ELECTRON_RENDERER_URL &&
      url.startsWith(process.env.ELECTRON_RENDERER_URL)
    ) {
      return { action: "allow" };
    }

    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
      return { action: "deny" }; // 阻止 Electron 创建新窗口
    }
    return { action: "allow" };
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

function setupAutoUpdater() {
  if (isDev || !app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("error", (error: unknown) => {
    isUpdateChecking = false;
    isUpdateDownloading = false;
    const manual = lastUpdateCheckManual;
    lastUpdateCheckManual = false;
    const message = extractErrorMessage(error);
    console.error("[autoUpdater:error]", message);
    sendUpdaterEvent({ type: "error", manual, message });
  });

  autoUpdater.on("update-available", (info: unknown) => {
    isUpdateChecking = false;
    hasDownloadedUpdate = false;
    console.log("[autoUpdater] update available");
    sendUpdaterEvent(createUpdaterEvent("available", info, lastUpdateCheckManual));
    lastUpdateCheckManual = false;
  });

  autoUpdater.on("update-not-available", (info: unknown) => {
    isUpdateChecking = false;
    console.log("[autoUpdater] no update available");
    sendUpdaterEvent(createUpdaterEvent("not-available", info, lastUpdateCheckManual));
    lastUpdateCheckManual = false;
  });

  autoUpdater.on("download-progress", (progress: unknown) => {
    isUpdateDownloading = true;
    sendUpdaterEvent(createUpdaterProgressEvent(progress));
  });

  autoUpdater.on("update-downloaded", (info: unknown) => {
    isUpdateDownloading = false;
    hasDownloadedUpdate = true;
    console.log("[autoUpdater] update downloaded");
    sendUpdaterEvent({ type: "downloaded", info: normalizeUpdaterInfo(info) });
  });
}

let isQuitting = false;
app.on("before-quit", (event) => {
  if (isInstallingUpdate) return;
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  clearBackend()
    .catch(() => {})
    .then(() => {
      app.quit();
    });
});

app.whenReady().then(() => {
  // Register custom web:// protocol handler for serving project files.
  // URL format: web://project/<projectId>/<relative-path>
  // Allows HTML files to reference relative paths (images, CSS, JS) naturally.
  protocol.handle("web", async (request) => {
    const url = new URL(request.url);

    // Handle web://project/... URLs
    if (url.host === "project") {
      const pathParts = url.pathname.split("/");
      const projectId = pathParts[1] || "";
      const relativePath = decodeURIComponent(pathParts.slice(2).join("/") || "");

      if (!projectId || !relativePath) {
        return new Response("Bad Request", { status: 400 });
      }

      const project = storageOps.getProject(projectId);
      if (!project) {
        return new Response("Project Not Found", { status: 404 });
      }

      const result = await serveProjectFile(project.cwd, relativePath);

      // Use Blob to bridge the Node.js Buffer / string → BodyInit gap
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = new Blob([result.body as any], { type: result.mimeType });
      return new Response(blob, {
        status: result.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      });
    }

    // Handle web://automation/<scheduleId>/task/<taskId>/<relative-path>
    if (url.host === "automation") {
      const pathParts = url.pathname.split("/");
      const scheduleId = pathParts[1] || "";
      const taskId = pathParts[3] || "";
      const relativePath = decodeURIComponent(pathParts.slice(4).join("/") || "");

      if (!scheduleId || pathParts[2] !== "task" || !taskId || !relativePath) {
        return new Response("Bad Request", { status: 400 });
      }

      const { store } = await import("../backend/automation/store");
      const taskDir = store.taskDir(scheduleId, taskId);
      const result = await serveProjectFile(taskDir, relativePath);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = new Blob([result.body as any], { type: result.mimeType });
      return new Response(blob, {
        status: result.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  });

  setupMenu();
  createMainWindow();
  setupAutoUpdater();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
