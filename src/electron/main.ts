import "./env";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  nativeTheme,
  MenuItemConstructorOptions,
} from "electron";
import electronUpdater from "electron-updater";
import { setupTitlebarAndAttachToWindow } from "custom-electron-titlebar/main";
import { homedir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { initBackend } from "../backend/backend";
import { createPeripheralHost } from "./peripherals";
import type { FelloIPCSchema } from "../shared/schema";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const launchEditor = require("launch-editor");

import { extractErrorMessage } from "../backend/utils";
import { storageOps } from "../backend/storage";
import { parseFileRoute, serveRoute } from "../backend/file-routes";
import { applyProxy, detectSystemProxy, settingProxyInfoToProxyConfig } from "../backend/proxy";
import type { SettingProxyInfo } from "../shared/schema";
import {
  createAutoUpdateCheckGate,
  createUpdaterEvent,
  createUpdaterProgressEvent,
  normalizeUpdaterInfo,
  type UpdaterEvent,
} from "./updater";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const { autoUpdater } = electronUpdater;

// Set to true to mock the update flow in dev mode for UI testing.
const UPDATER_MOCK = false;

if (isDev) {
  app.commandLine.appendSwitch("no-sandbox");
  // app.disableHardwareAcceleration();
}

// Register the custom `fello://` scheme as privileged before app is ready.
// This enables standard URL parsing, fetch support, and CORS in iframes.
// URL 格式: fello://web/<resourceType>/<path>
protocol.registerSchemesAsPrivileged([
  {
    scheme: "fello",
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

// ── Apply proxy as early as possible ──────────────────────────────
// 必须在任何网络请求 / 子进程 spawn 之前执行：
// 1. undici 全局 dispatcher（覆盖主进程 fetch）
// 2. http/https globalAgent（覆盖 electron-updater 等）
// 3. process.env（子进程自动继承；MCP stdio 子进程在 mcp-tools.ts 显式合并）
// system 模式：detectSystemProxy 为同步实现（scutil/netsh 毫秒级），
// 启动早期即可一次探测完整生效，无需后续异步补齐。
const proxySettings = storageOps.getSettings().proxy;
applyProxy(
  proxySettings.mode === "system"
    ? detectSystemProxy()
    : settingProxyInfoToProxyConfig(proxySettings),
);

const { backendHandlers, closeBackend } = initBackend(safeSend);

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
        const result = await (backendHandlers as any)[channel](params);
        // 外设「生效」状态存在 settings 里，任何来源（含 WebUI）改动后都要让主进程
        // 重新装载/卸载通道；装载是异步且不阻塞的，这里不等待。
        if (channel === "updateSettings") syncPeripherals();
        return result;
      } catch (error) {
        throw new Error(extractErrorMessage(error));
      }
    },
  );
}

// ── 外设宿主（Electron 专属） ───────────────────────────────────────
// 外设只在桌面应用里生效：headless server 走 src/server，不会加载本模块；
// WebUI 不装载任何通道，设置页只做只读展示。任何通道失败都只上报状态。
const peripheralHost = createPeripheralHost({
  publish: {
    status: (status) => void safeSend("peripheral-status", status),
    key: (event) => void safeSend("peripheral-key", event),
    audio: (event) => void safeSend("peripheral-audio", event),
    audioState: (event) => void safeSend("peripheral-audio-state", event),
  },
});

/**
 * 上一次同步出去的「生效」集合签名。
 *
 * `updateSettings` 会被各类设置写入触发（主题、代理……），其中绝大多数与外设无关；
 * 先比对签名再同步，免得每次写设置都做一遍全量 mount/unmount 检查。
 * 初始 `null` 保证启动时一定跑一次（否则默认空集合会被当成「已经同步过」）。
 */
let lastSyncedPeripheralIds: string | null = null;

function syncPeripherals() {
  const enabled = storageOps
    .getSettings()
    .peripherals.filter((peripheral) => peripheral.enabled)
    .map((peripheral) => peripheral.id)
    .sort();
  const signature = enabled.join(",");
  if (signature === lastSyncedPeripheralIds) return;
  lastSyncedPeripheralIds = signature;
  void peripheralHost.syncEnabled(enabled).catch((error: unknown) => {
    console.error("[peripheral] sync failed:", extractErrorMessage(error));
  });
}

ipcMain.handle("getPeripheralStatuses", () => peripheralHost.getStatuses());

ipcMain.handle("peripheralConnect", async (_event: unknown, peripheralId: string) => {
  try {
    await peripheralHost.connect(peripheralId);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
});

ipcMain.handle("peripheralVoiceStart", async (_event: unknown, peripheralId: string) => {
  try {
    // 必须把 captureId 透传回渲染层：音频帧按它过滤，漏掉返回值的直接后果是
    // 「面板能录音、音频也在流，但一帧都不会被喂给 ASR」。
    return await peripheralHost.startVoice(peripheralId);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
});

ipcMain.handle("peripheralVoiceStop", async (_event: unknown, peripheralId: string) => {
  try {
    await peripheralHost.stopVoice(peripheralId);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
});

/**
 * 退出前等待外设收尾的上界。
 *
 * 收尾可能要等一次**进行中的连接**（会话内部最长 45s 扫描，外层还套了 70s 上界），
 * 那会把 `app.quit()` 推迟几十秒 —— 用户看到的是「点了退出却关不掉」。
 * 超时就不再等：原生句柄随进程一起释放。
 */
const PERIPHERAL_SHUTDOWN_TIMEOUT_MS = 2000;

/** 给一个 Promise 加上界；超时抛错（原 Promise 之后的结果会被忽略）。 */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}超时（${timeoutMs} ms）`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 退出 / 重启前的统一收尾：先放掉外设的原生句柄（BLE / HID），再关后端。 */
async function shutdown() {
  await withTimeout(peripheralHost.destroy(), PERIPHERAL_SHUTDOWN_TIMEOUT_MS, "外设收尾").catch(
    (error: unknown) => {
      console.error("[peripheral] destroy failed:", extractErrorMessage(error));
    },
  );
  await closeBackend().catch(() => {});
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

/**
 * 打开 macOS 的「输入监控」隐私设置面板。
 *
 * HID 通道首次打开设备时系统会自己弹窗并把 Fello 登记进「输入监控」列表；但用户拒绝过之后
 * 系统不再弹窗，而权限状态又无法通过 API 查询，因此设置页提供这个直达入口。
 * （非 macOS 平台不做任何事。）
 */
ipcMain.handle("openPeripheralPermissionSettings", async () => {
  if (process.platform !== "darwin") return;
  try {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
    );
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
});

ipcMain.handle(
  "openInEditor",
  async (_event: unknown, params: { filePath: string; editor?: string }) => {
    try {
      const { filePath, editor } = params;
      launchEditor(filePath, editor, (fileName: string, errorMsg: string | null) => {
        if (errorMsg) {
          console.error(`launch-editor failed for ${fileName}: ${errorMsg}`);
        }
      });
    } catch (error) {
      throw new Error(extractErrorMessage(error));
    }
  },
);

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
    if (!UPDATER_MOCK) {
      console.log("[checkForUpdates] skipped in dev mode");
      sendUpdaterEvent({
        type: "disabled",
        manual,
        reason: "Updates are available only in packaged builds.",
      });
      return;
    }
    console.log("[checkForUpdates] mock update flow in dev mode");
    await mockCheckForUpdates(manual);
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

// ── Mock update flow for dev mode ──────────────────────────────────
const MOCK_UPDATE_INFO = {
  version: "99.0.0",
  releaseName: "v99.0.0 (Mock Update)",
  releaseDate: new Date().toISOString(),
  releaseNotes: "This is a simulated update for UI testing in dev mode.",
};

async function mockCheckForUpdates(manual: boolean) {
  if (isUpdateChecking) return;
  isUpdateChecking = true;
  lastUpdateCheckManual = manual;
  sendUpdaterEvent({ type: "checking", manual });

  await delay(1000);

  isUpdateChecking = false;
  hasDownloadedUpdate = false;
  sendUpdaterEvent({ type: "available", manual, info: MOCK_UPDATE_INFO });
  lastUpdateCheckManual = false;
}

async function mockDownloadUpdate() {
  isUpdateDownloading = true;
  const totalBytes = 85_000_000; // simulate ~85MB
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await delay(150);
    const percent = (i / steps) * 100;
    sendUpdaterEvent({
      type: "download-progress",
      percent: Math.round(percent * 10) / 10,
      transferred: Math.round((totalBytes * i) / steps),
      total: totalBytes,
      bytesPerSecond: 4_200_000,
    });
  }
  isUpdateDownloading = false;
  hasDownloadedUpdate = true;
  sendUpdaterEvent({ type: "downloaded", info: MOCK_UPDATE_INFO });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadAvailableUpdate() {
  if (isDev && UPDATER_MOCK) {
    if (isUpdateDownloading || hasDownloadedUpdate) return;
    if (lastUpdaterEvent?.type !== "available") {
      const message = "No update is ready to download.";
      sendUpdaterEvent({ type: "error", manual: true, message });
      throw new Error(message);
    }
    await mockDownloadUpdate();
    return;
  }

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
  if (isDev && UPDATER_MOCK) {
    if (!hasDownloadedUpdate) {
      throw new Error("No downloaded update is ready to install.");
    }
    // In dev mode, just log and restart the app
    console.log("[mock] installDownloadedUpdate: simulating restart");
    isInstallingUpdate = true;
    await shutdown();
    app.relaunch();
    app.exit(0);
    return;
  }

  if (!hasDownloadedUpdate) {
    throw new Error("No downloaded update is ready to install.");
  }

  isInstallingUpdate = true;
  await shutdown();
  autoUpdater.quitAndInstall(false, true);
}

// ── Restart app ────────────────────────────────────────────────────
let isRestarting = false;

async function restartApp() {
  if (isRestarting) return;
  isRestarting = true;
  await shutdown();
  // app.exit 不触发 before-quit，shutdown 已在上方完成优雅关闭。
  app.relaunch();
  app.exit(0);
}

// 前端保存代理设置后由 useMessage confirm 提示，确认后调用此 IPC。
ipcMain.handle("restartApp", async () => {
  await restartApp();
});

// ── Chromium proxy (renderer / net) ────────────────────────────────
// 注意：proxyRules 不支持 userinfo 认证，认证凭据通过 app 'login' 事件提供。
function buildChromiumProxyRules(proxy: SettingProxyInfo): string {
  const httpProxy = proxy.httpProxy?.trim();
  const httpsProxy = (proxy.httpsProxy || proxy.httpProxy)?.trim();
  const rules: string[] = [];
  if (httpProxy) rules.push(`http=${httpProxy}`);
  if (httpsProxy) rules.push(`https=${httpsProxy}`);
  return rules.join(";");
}

async function applyChromiumProxy() {
  const proxy = storageOps.getSettings().proxy;
  try {
    if (proxy.mode === "off") {
      await session.defaultSession.setProxy({ mode: "direct" });
      return;
    }
    if (proxy.mode === "system") {
      // Chromium 侧直接跟随系统（支持 PAC）。
      await session.defaultSession.setProxy({ mode: "system" });
      return;
    }
    await session.defaultSession.setProxy({
      mode: "fixed_servers",
      proxyRules: buildChromiumProxyRules(proxy),
      proxyBypassRules: proxy.noProxy || undefined,
    });
  } catch (error) {
    console.error("[proxy] Failed to apply Chromium proxy:", extractErrorMessage(error));
  }
}

// 代理认证：仅当配置了 manual 模式且带用户名时，为代理 407 提供凭据
app.on("login", (event, _webContents, _details, authInfo, callback) => {
  if (!authInfo.isProxy) {
    callback();
    return;
  }
  const proxy = storageOps.getSettings().proxy;
  if (proxy.mode === "manual" && proxy.username) {
    event.preventDefault();
    callback(proxy.username, proxy.password ?? "");
  } else {
    callback();
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
            y: 16,
          },
        }
      : {
          titleBarStyle: "hidden",
          titleBarOverlay: true,
        }),
    webPreferences: {
      preload: join(process.scriptsPath, "electron-preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.platform !== "darwin") {
    setupTitlebarAndAttachToWindow(win);
  }

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
    win.loadFile(join(process.rendererPath, "index.html"));
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
  shutdown().then(() => {
    app.quit();
  });
});

app.whenReady().then(async () => {
  // 权限白名单：只放行麦克风/摄像头（语音输入）与 HTML 全屏。
  //
  // `fullscreen` 必须放行 —— Electron 把 HTML 全屏也挂在权限管线上：请求被拒时
  // Chromium 既不 resolve 也不 reject `requestFullscreen()`（Promise 永久 pending、
  // 无任何报错），表现就是 <video> 原生控件里的全屏按钮「点了没反应」。
  // 只放行 `media` 时，视频卡片的全屏按钮、详情面板播放器的全屏都会是死键。
  const isAllowedPermission = (permission: string) =>
    permission === "media" || permission === "fullscreen";

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    isAllowedPermission(permission),
  );
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isAllowedPermission(permission));
  });

  // Register custom fello:// protocol handler for serving files.
  // 仅响应 fello://web/...，统一由 file-routes.ts 解析:
  //   fello://web/project/<projectId>/<relativePath>
  //   fello://web/share/<projectId>/<sessionId>/<sharePath>
  //   fello://web/automation/<scheduleId>/<taskId>/<relativePath>
  protocol.handle("fello", async (request) => {
    const url = new URL(request.url);
    // 仅响应 fello://web/... 请求
    if (url.host !== "web") {
      return new Response("Not Found", { status: 404 });
    }
    const route = parseFileRoute(url);

    if (!route) {
      return new Response("Not Found", { status: 404 });
    }

    const result = await serveRoute(route, { range: request.headers.get("range") });

    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      ...result.headers,
    };

    // Range 命中：分片流式返回（大视频不必整份读进内存，拖动进度条只读那一段）。
    if (result.stream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Response(Readable.toWeb(result.stream) as any, {
        status: result.status,
        headers,
      });
    }

    // Use Blob to bridge the Node.js Buffer / string → BodyInit gap
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blob = new Blob([result.body as any], { type: result.mimeType });
    return new Response(blob, { status: result.status, headers });
  });

  setupMenu();
  // 先应用 Chromium 代理，再创建窗口，确保窗口内所有请求都走已配置的代理
  await applyChromiumProxy();
  createMainWindow();
  setupAutoUpdater();
  // 窗口建立后再同步外设：状态事件需要 mainWindow 才能送达渲染层。
  // 这里不 await：BLE 装配（含 45s 扫描）不得推迟窗口可用时间。
  syncPeripherals();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
