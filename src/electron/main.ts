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
  Notification,
} from "electron";
import electronUpdater from "electron-updater";
import { setupTitlebarAndAttachToWindow } from "custom-electron-titlebar/main";
import { homedir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { initBackend } from "../backend/backend";
import { createPeripheralHost } from "./peripherals";
import type { AskUserRequest, AskUserResponse, FelloIPCSchema } from "../shared/schema";
import { createRequire } from "module";
const nodeRequire = createRequire(import.meta.url);
const launchEditor = nodeRequire("launch-editor");

import { extractErrorMessage } from "../backend/utils";
import { t } from "../backend/i18n";
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
  type UpdaterInfo,
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
const askUserNotifications = new Map<string, Notification>();
let pendingSessionNavigation: string | null = null;
let rendererReadyWindow: BrowserWindow | null = null;
/** Filled in after initBackend(); safe to call from notification handlers after startup. */
let isAssistantSessionId = (_sessionId: string): boolean => false;
let isAssistantAvailable = (_sessionId: string): boolean => false;

function getActiveSessionIdFromWindow(win: BrowserWindow): string | null {
  if (win.isDestroyed()) return null;

  try {
    const hash = new URL(win.webContents.getURL()).hash;
    const route = hash.startsWith("#") ? hash.slice(1) : hash;
    const prefix = "/session-view/";
    if (!route.startsWith(prefix)) return null;
    const encodedSessionId = route.slice(prefix.length).split(/[?#]/, 1)[0];
    return encodedSessionId ? decodeURIComponent(encodedSessionId) : null;
  } catch {
    return null;
  }
}

function shouldShowAskUserNotification(sessionId: string): boolean {
  const win = mainWindow;
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !win.isFocused()) {
    return true;
  }
  // Assistant pseudo sessions are "active" whenever their own page is showing.
  if (isAssistantSessionId(sessionId)) {
    return !currentRouteOfWindow(win).startsWith(`/assistant/${sessionId}`);
  }
  return getActiveSessionIdFromWindow(win) !== sessionId;
}

function closeAskUserNotification(askUserId: string) {
  const notification = askUserNotifications.get(askUserId);
  if (notification) {
    askUserNotifications.delete(askUserId);
    notification.close();
  }

  if (process.platform === "darwin") {
    try {
      Notification.remove(askUserId);
    } catch (error) {
      console.warn(`[askUser] Failed to remove delivered notification ${askUserId}:`, error);
    }
  }
}

function closeDisabledAskUserNotifications() {
  if (storageOps.getSettings().notification.askUser) return;
  for (const askUserId of askUserNotifications.keys()) {
    closeAskUserNotification(askUserId);
  }
}

function showAskUserNotification(request: AskUserRequest) {
  if (!app.isReady() || !storageOps.getSettings().notification.askUser) return;

  const supported = Notification.isSupported();
  const shouldShow = shouldShowAskUserNotification(request.sessionId);
  if (!supported || !shouldShow || askUserNotifications.has(request.askUserId)) {
    if (!supported) {
      console.warn("[askUser] Native notifications are not supported on this system");
    }
    return;
  }

  let notification: Notification;
  try {
    notification = new Notification({
      id: request.askUserId,
      groupId: "ask-user",
      title: t("askUser.notificationTitle"),
      body: request.title.trim() || t("askUser.notificationBody"),
    });
  } catch (error) {
    console.error("[askUser] Failed to create native notification:", error);
    return;
  }
  askUserNotifications.set(request.askUserId, notification);

  notification.on("show", () => {
    console.info(`[askUser] Native notification shown for ${request.askUserId}`);
  });
  notification.on("failed", (_event, error) => {
    if (askUserNotifications.get(request.askUserId) === notification) {
      askUserNotifications.delete(request.askUserId);
    }
    console.error(`[askUser] Native notification failed for ${request.askUserId}:`, error);
    if (process.platform === "darwin" && !app.isPackaged) {
      console.error(
        "[askUser] macOS native notifications require a code-signed app; the Electron development binary is not a valid signed app.",
      );
    }
  });
  notification.on("click", () => {
    closeAskUserNotification(request.askUserId);
    if (isAssistantSessionId(request.sessionId)) {
      if (isAssistantAvailable(request.sessionId)) {
        openAssistantFromNotification(request.sessionId);
      }
    } else {
      openSessionFromNotification(request.sessionId);
    }
  });
  notification.on("close", () => {
    if (askUserNotifications.get(request.askUserId) === notification) {
      askUserNotifications.delete(request.askUserId);
    }
  });
  try {
    notification.show();
  } catch (error) {
    if (askUserNotifications.get(request.askUserId) === notification) {
      askUserNotifications.delete(request.askUserId);
    }
    console.error(`[askUser] Failed to show native notification for ${request.askUserId}:`, error);
  }
}

function flushPendingSessionNavigation(win: BrowserWindow) {
  if (
    !pendingSessionNavigation ||
    mainWindow !== win ||
    rendererReadyWindow !== win ||
    win.isDestroyed() ||
    win.webContents.isLoading() ||
    !win.webContents.getURL()
  ) {
    return;
  }

  const sessionId = pendingSessionNavigation;
  pendingSessionNavigation = null;
  safeSend("open-session-requested", { sessionId });
}

function openSessionFromNotification(sessionId: string) {
  pendingSessionNavigation = sessionId;

  let win = mainWindow;
  if (!win || win.isDestroyed()) {
    if (!app.isReady()) return;
    win = createMainWindow();
  }

  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();

  flushPendingSessionNavigation(win);
}

/** Route of the window's current page, for example "/assistant", or "" when unknown. */
function currentRouteOfWindow(win: BrowserWindow): string {
  try {
    const hash = new URL(win.webContents.getURL()).hash;
    return hash.startsWith("#") ? hash.slice(1) : hash;
  } catch {
    return "";
  }
}

function shouldShowReminderNotification(assistantId: string): boolean {
  const win = mainWindow;
  return (
    !win ||
    win.isDestroyed() ||
    !win.isVisible() ||
    win.isMinimized() ||
    !win.isFocused() ||
    !currentRouteOfWindow(win).startsWith(`/assistant/${assistantId}`)
  );
}

function openAssistantFromNotification(assistantId: string) {
  let win = mainWindow;
  if (!win || win.isDestroyed()) {
    if (!app.isReady()) return;
    win = createMainWindow();
  }

  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();

  const target = win;
  const send = () => {
    if (!target.isDestroyed()) {
      target.webContents.send("open-assistant-requested", { assistantId });
    }
  };
  if (target.webContents.isLoading()) {
    target.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function showReminderNotification(reminder: FelloIPCSchema["events"]["assistant-reminder-due"]) {
  if (!app.isReady() || !storageOps.getSettings().notification.reminder) return;
  if (!Notification.isSupported()) {
    console.warn("[reminder] Native notifications are not supported on this system");
    return;
  }
  if (!shouldShowReminderNotification(reminder.assistantId)) return;

  let notification: Notification;
  try {
    notification = new Notification({
      id: `reminder:${reminder.assistantId}:${reminder.id}:${reminder.dueAt}`,
      groupId: "reminder",
      title: reminder.name || t("reminder.notificationTitle"),
      body: reminder.text,
    });
  } catch (error) {
    console.error("[reminder] Failed to create native notification:", error);
    return;
  }

  notification.on("failed", (_event, error) => {
    console.error(`[reminder] Native notification failed for ${reminder.id}:`, error);
  });
  notification.on("click", () => {
    if (isAssistantAvailable(reminder.assistantId)) {
      openAssistantFromNotification(reminder.assistantId);
    }
  });
  try {
    notification.show();
  } catch (error) {
    console.error("[reminder] Failed to show native notification:", error);
  }
}

function safeSend<K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
): boolean {
  if (channel === "ask-user-request") {
    showAskUserNotification(payload as AskUserRequest);
  } else if (channel === "ask-user-response") {
    closeAskUserNotification((payload as AskUserResponse).askUserId);
  } else if (channel === "assistant-reminder-due") {
    showReminderNotification(payload as FelloIPCSchema["events"]["assistant-reminder-due"]);
  }

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

const {
  backendHandlers,
  closeBackend,
  isAssistantSession,
  isAssistantAvailable: isAssistantAvailableSync,
} = initBackend(safeSend, {
  trashItem: (path) => shell.trashItem(path),
});
isAssistantSessionId = isAssistantSession;
isAssistantAvailable = isAssistantAvailableSync;

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
        if (channel === "updateSettings") {
          syncPeripherals();
          closeDisabledAskUserNotifications();
        }
        return result;
      } catch (error) {
        throw new Error(extractErrorMessage(error));
      }
    },
  );
}

ipcMain.handle("rendererReady", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== mainWindow || win.isDestroyed()) return;
  rendererReadyWindow = win;
  flushPendingSessionNavigation(win);
});

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

/**
 * 硬终止当前进程（**退出路径的最后兜底**，正常不会走到）。
 *
 * 外设的「开着点退出卡死」已在 host 层根治：`peripheralHost.destroy()` 会先销毁 BLE manager、
 * 停掉进行中的扫描，再收干净各通道，于是 `shutdown()` 能在 2s 上界内完成、`app.quit()` 正常退出。
 *
 * 这里只应对将来可能回归的坏情况：某个原生 addon（CoreBluetooth / node-hid）留下常驻后台线程，
 * 让 `app.quit()`（等事件循环排空）或 `app.exit()`/`process.exit()`（环境销毁阶段 join / 析构
 * 这些线程）被挂起。SIGKILL 由内核直接回收进程，不经过 JS / 原生析构，任何卡住的线程都拦不住它，
 * 所以用它保证进程真的结束。
 */
function hardExit(): never {
  try {
    process.kill(process.pid, "SIGKILL");
  } catch {
    // 理论上到不了：SIGKILL 发给自己不会失败。兜底再退一次。
  }
  // SIGKILL 是异步投递的，极端情况下调用返回后进程还活着一瞬：用 app.exit 兜底，
  // 并把本函数标成 never（后面不应再有代码执行）。
  app.exit(0);
  // 让类型系统满意：上面两步必然终止进程，这里不会真正返回。
  throw new Error("unreachable");
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
/**
 * 渲染层重新挂载时用来恢复升级卡片的「可恢复状态」。
 *
 * checking / error 只是过程信息，不覆盖它：否则一次检查就会把「已下载待重启」的状态弄丢。
 */
let lastRestorableUpdaterEvent: UpdaterEvent | null = null;
/** 最近一次检查到的更新信息：下载 / 重试需要它，不能只依赖「最后一个事件」。 */
let availableUpdateInfo: UpdaterInfo | null = null;
/** 已下载的更新信息与版本号：用于识别「重检查发现同一版本」并保持待重启状态。 */
let downloadedUpdateInfo: UpdaterInfo | null = null;
let downloadedVersion: string | null = null;
let lastUpdateCheckManual = false;
let isUpdateChecking = false;
let isUpdateDownloading = false;
let hasDownloadedUpdate = false;
let isInstallingUpdate = false;
/** 安装 / 重启阶段若迟迟没有退出，用看门狗恢复 UI（否则会永远停在「正在重启…」）。 */
const INSTALL_WATCHDOG_MS = 30_000;
let installWatchdog: ReturnType<typeof setTimeout> | null = null;

function sendUpdaterEvent(event: UpdaterEvent) {
  switch (event.type) {
    case "available":
    case "download-progress":
    case "downloaded":
    case "download-failed":
    case "install-failed":
      lastRestorableUpdaterEvent = event;
      break;
    case "not-available":
    case "disabled":
      lastRestorableUpdaterEvent = null;
      break;
    case "checking":
    case "error":
      // 过程状态不覆盖可恢复的卡片状态
      break;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send("electron:updater-event", event);
}

ipcMain.handle("getUpdaterStatus", () => lastRestorableUpdaterEvent);

/**
 * 安装阶段失败的统一收尾：复位标记、清掉看门狗，并把失败原因送回渲染层。
 *
 * 走到这里时 `shutdown()` 通常已经执行过（后端 / 外设不可用），所以卡片只能引导
 * 用户重启应用后重新更新，而不是继续重试安装。
 */
function failInstall(message: string) {
  if (installWatchdog) {
    clearTimeout(installWatchdog);
    installWatchdog = null;
  }
  isInstallingUpdate = false;
  sendUpdaterEvent({
    type: "install-failed",
    message,
    info: downloadedUpdateInfo ?? availableUpdateInfo ?? {},
  });
}

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

  if (isUpdateChecking) {
    // 已有检查在进行：手动点击仍然给出反馈，并把这次的结果按手动检查处理。
    if (manual) {
      lastUpdateCheckManual = true;
      sendUpdaterEvent({ type: "checking", manual: true });
    }
    return;
  }

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
  if (isUpdateChecking) {
    if (manual) {
      lastUpdateCheckManual = true;
      sendUpdaterEvent({ type: "checking", manual: true });
    }
    return;
  }
  isUpdateChecking = true;
  lastUpdateCheckManual = manual;
  sendUpdaterEvent({ type: "checking", manual });

  await delay(1000);

  isUpdateChecking = false;
  availableUpdateInfo = MOCK_UPDATE_INFO;
  // 与真实 updater 保持一致：同一版本已下载时保持「待重启」，不要打回「可下载」。
  if (hasDownloadedUpdate) {
    sendUpdaterEvent({
      type: "downloaded",
      info: downloadedUpdateInfo ?? MOCK_UPDATE_INFO,
      manual,
    });
  } else {
    sendUpdaterEvent({ type: "available", manual, info: MOCK_UPDATE_INFO });
  }
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
  downloadedUpdateInfo = MOCK_UPDATE_INFO;
  downloadedVersion = MOCK_UPDATE_INFO.version;
  sendUpdaterEvent({ type: "downloaded", info: MOCK_UPDATE_INFO });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadAvailableUpdate() {
  if (isDev && UPDATER_MOCK) {
    if (isUpdateDownloading) return;
    if (hasDownloadedUpdate) {
      sendUpdaterEvent({ type: "downloaded", info: downloadedUpdateInfo ?? MOCK_UPDATE_INFO });
      return;
    }
    if (!availableUpdateInfo) {
      const message = "No update is ready to download.";
      sendUpdaterEvent({ type: "error", manual: true, message });
      throw new Error(message);
    }
    isUpdateDownloading = true;
    // 立即把卡片切到「下载中」，不要等第一个真实进度事件。
    sendUpdaterEvent({ type: "download-progress", percent: 0 });
    await mockDownloadUpdate();
    return;
  }

  if (!isUpdaterEnabled()) {
    throw new Error("Updates are available only in packaged builds.");
  }
  if (isUpdateDownloading) return;
  if (hasDownloadedUpdate) {
    // 已下载：把卡片恢复到「待重启」，而不是静默返回、留下一个按不动的死按钮。
    if (downloadedUpdateInfo) {
      sendUpdaterEvent({ type: "downloaded", info: downloadedUpdateInfo });
    }
    return;
  }
  if (!availableUpdateInfo) {
    const message = "No update is ready to download.";
    sendUpdaterEvent({ type: "error", manual: true, message });
    throw new Error(message);
  }

  isUpdateDownloading = true;
  // electron-updater（尤其差分下载）在第一个 progress 事件之前要先取 blockmap / 建立连接，
  // 可能空等好几秒。先发一个 0% 让卡片立刻进入「下载中」，避免用户以为没点上。
  sendUpdaterEvent({ type: "download-progress", percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    isUpdateDownloading = false;
    const message = extractErrorMessage(error);
    // 保留可重试状态：卡片显示「下载失败 + 重试」，不会直接消失。
    sendUpdaterEvent({ type: "download-failed", message, info: availableUpdateInfo ?? {} });
    throw new Error(message);
  }
}

async function installDownloadedUpdate() {
  // 卡片上的重启按钮可能被连点：收尾 / 重启只允许跑一次。
  if (isInstallingUpdate) return;
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
  if (installWatchdog) clearTimeout(installWatchdog);
  // quitAndInstall 在部分平台是「触发后不保证退出」：失败时既不抛错也不 quit
  // （本地未签名构建就是典型情况）。加看门狗，超时后把失败状态送回渲染层。
  installWatchdog = setTimeout(() => {
    installWatchdog = null;
    if (!isInstallingUpdate) return;
    console.warn("[autoUpdater] install / restart did not complete in time");
    failInstall("");
  }, INSTALL_WATCHDOG_MS);
  installWatchdog.unref?.();

  try {
    await shutdown();
    autoUpdater.quitAndInstall(false, true);
  } catch (error) {
    // 同步失败：恢复 UI 并提示重启应用，避免永远停在「正在重启…」。
    const message = extractErrorMessage(error);
    failInstall(message);
    throw new Error(message);
  }
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
        {
          label: "Check for Updates...",
          click: () => void checkForUpdates({ manual: true }).catch(() => {}),
        },
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
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
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
  rendererReadyWindow = null;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    if (rendererReadyWindow === win) rendererReadyWindow = null;
  });
  win.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace && rendererReadyWindow === win) {
      rendererReadyWindow = null;
    }
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

  win.webContents.on("did-finish-load", () => {
    flushPendingSessionNavigation(win);
  });

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
    const wasChecking = isUpdateChecking;
    const wasDownloading = isUpdateDownloading;
    const wasInstalling = isInstallingUpdate;
    isUpdateChecking = false;
    // 下载进行中又插了一次检查时，error 可能来自检查本身，不能据此判定下载结束；
    // 真正的下载失败会在 downloadAvailableUpdate 的 catch 里复位该标记。
    if (!wasChecking) isUpdateDownloading = false;
    const manual = lastUpdateCheckManual;
    lastUpdateCheckManual = false;
    const message = extractErrorMessage(error);
    console.error("[autoUpdater:error]", message);
    if (wasInstalling) {
      // 安装 / 重启阶段失败（例如 macOS 签名不匹配、Squirrel 报错）。
      failInstall(message);
      return;
    }
    // 下载失败要保留可重试状态；检查阶段的 error 只是提示，不动卡片。
    // 下载进行中又插了一次手动检查时，error 更可能来自检查，交给检查分支。
    if (wasDownloading && !wasChecking) {
      sendUpdaterEvent({ type: "download-failed", message, info: availableUpdateInfo ?? {} });
    } else {
      sendUpdaterEvent({ type: "error", manual, message });
    }
  });

  autoUpdater.on("update-available", (info: unknown) => {
    isUpdateChecking = false;
    const normalized = normalizeUpdaterInfo(info);
    const manual = lastUpdateCheckManual;
    lastUpdateCheckManual = false;
    if (isUpdateDownloading) {
      // 下载进行中：检查结果不打断进度卡片（进度事件会继续更新它）。
      if (!availableUpdateInfo) availableUpdateInfo = normalized;
      return;
    }
    availableUpdateInfo = normalized;
    // 同一版本已经下载完成时保持「待重启」。重检查（例如手动点菜单）会再次触发
    // update-available，若在这里清掉 hasDownloadedUpdate，重启按钮就会永远失败。
    const sameAsDownloaded =
      hasDownloadedUpdate &&
      (normalized.version == null || normalized.version === downloadedVersion);
    if (sameAsDownloaded && downloadedUpdateInfo) {
      console.log("[autoUpdater] update still ready to install");
      sendUpdaterEvent({ type: "downloaded", info: downloadedUpdateInfo, manual });
      return;
    }
    if (hasDownloadedUpdate) {
      // 出现了一个新版本：丢弃旧的已下载状态，允许重新下载新包。
      hasDownloadedUpdate = false;
      downloadedUpdateInfo = null;
      downloadedVersion = null;
    }
    console.log("[autoUpdater] update available");
    sendUpdaterEvent(createUpdaterEvent("available", info, manual));
  });

  autoUpdater.on("update-not-available", (info: unknown) => {
    isUpdateChecking = false;
    const manual = lastUpdateCheckManual;
    lastUpdateCheckManual = false;
    if (isUpdateDownloading) {
      // 下载进行中：保留进度与重试所需的信息，不被检查结果清空。
      console.log("[autoUpdater] no update available (download in progress, ignored)");
      return;
    }
    availableUpdateInfo = null;
    // feed 里已经没有更新：之前下载的包（例如发布被撤回）也不再允许安装。
    hasDownloadedUpdate = false;
    downloadedUpdateInfo = null;
    downloadedVersion = null;
    console.log("[autoUpdater] no update available");
    sendUpdaterEvent(createUpdaterEvent("not-available", info, manual));
  });

  autoUpdater.on("download-progress", (progress: unknown) => {
    isUpdateDownloading = true;
    sendUpdaterEvent(createUpdaterProgressEvent(progress));
  });

  autoUpdater.on("update-downloaded", (info: unknown) => {
    isUpdateDownloading = false;
    hasDownloadedUpdate = true;
    const normalized = normalizeUpdaterInfo(info);
    downloadedUpdateInfo = normalized;
    downloadedVersion = normalized.version ?? null;
    if (!availableUpdateInfo) availableUpdateInfo = normalized;
    console.log("[autoUpdater] update downloaded");
    sendUpdaterEvent({ type: "downloaded", info: normalized });
  });
}

let isQuitting = false;
app.on("before-quit", (event) => {
  if (isInstallingUpdate) return;
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  // 看门狗（最后兜底）：正常情况下 shutdown() 会把外设连接（含进行中的扫描）中止并收干净，
  // 之后 app.quit() 能正常退出。但万一某个原生句柄仍没放掉导致退出被挂起，这里到点强制结束，
  // 绝不让用户再次遇到「点了退出却关不掉」。unref 以免看门狗自己拖住事件循环。
  const watchdog = setTimeout(hardExit, PERIPHERAL_SHUTDOWN_TIMEOUT_MS + 2000);
  watchdog.unref?.();
  shutdown()
    .catch(() => {})
    .finally(() => {
      // 收尾已完成：优雅退出。看门狗继续挂着做兜底，真正退成了它也不会触发（已 unref）。
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
