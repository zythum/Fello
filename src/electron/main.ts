import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  nativeTheme,
  MenuItemConstructorOptions,
} from "electron";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { backendHandlers, initBackend, killBridge, type FelloIPCSchema } from "../backend/backend";
import { extractErrorMessage } from "../backend/utils";
import { storageOps } from "../backend/storage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

if (isDev) {
  app.commandLine.appendSwitch("no-sandbox");
  // app.disableHardwareAcceleration();
}

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
    ...(isDev
      ? ([
          {
            label: "View",
            submenu: [{ role: "toggleDevTools" }] satisfies MenuItemConstructorOptions[],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: "Window",
      submenu: [
        { role: "close" },
        { role: "minimize" },
        { role: "zoom" },
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
    minHeight: 600,
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
      win.webContents.send("ui:mac-fullscreen", true);
    });
    win.on("leave-full-screen", () => {
      win.webContents.send("ui:mac-fullscreen", false);
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

let isQuitting = false;
app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  killBridge()
    .catch(() => {})
    .then(() => {
      app.quit();
    });
});

app.whenReady().then(() => {
  setupMenu();
  createMainWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
