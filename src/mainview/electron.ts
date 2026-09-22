import { isWebUI } from "./backend";
import type { PeripheralStatus } from "../shared/peripherals";
import type { UpdaterEvent } from "../electron/updater";

export { type UpdaterEvent };

export const electron = {
  getPathForFile: (file: File): string => {
    if (isWebUI) return "";
    return window.fello!.getPathForFile(file);
  },
  showOpenDialog: async (): Promise<string | null> => {
    if (isWebUI) {
      console.warn(
        "WebUI mode: showOpenDialog is not supported. Please select directory from host.",
      );
      return null;
    }
    return window.fello!.invoke("showOpenDialog");
  },
  revealInFinder: async (path: string): Promise<void> => {
    if (isWebUI) {
      console.warn("WebUI mode: revealInFinder is not supported on client machine.");
      return;
    }
    return window.fello!.invoke("revealInFinder", path);
  },
  openInEditor: async (filePath: string, editor?: string): Promise<void> => {
    if (isWebUI) {
      console.warn("WebUI mode: openInEditor is not supported on client machine.");
      return;
    }
    return window.fello!.invoke("openInEditor", { filePath, editor });
  },
  openInBrowser: async (url: string): Promise<void> => {
    if (isWebUI) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    return window.fello!.invoke("openInBrowser", url);
  },
  trashFile: async (path: string): Promise<void> => {
    if (isWebUI) {
      console.warn("WebUI mode: trashFile is not supported.");
      return;
    }
    return window.fello!.invoke("trashFile", path);
  },
  getUpdaterStatus: async (): Promise<UpdaterEvent | null> => {
    if (isWebUI) return null;
    return window.fello!.invoke("getUpdaterStatus");
  },
  checkForUpdates: async (manual = true): Promise<void> => {
    if (isWebUI) return;
    return window.fello!.invoke("checkForUpdates", { manual });
  },
  downloadUpdate: async (): Promise<void> => {
    if (isWebUI) return;
    return window.fello!.invoke("downloadUpdate");
  },
  installUpdate: async (): Promise<void> => {
    if (isWebUI) return;
    return window.fello!.invoke("installUpdate");
  },
  restartApp: async (): Promise<void> => {
    if (isWebUI) {
      console.warn("WebUI mode: restartApp is not supported. Restart the server process manually.");
      return;
    }
    return window.fello!.invoke("restartApp");
  },

  updateTheme: (theme: "dark" | "light") => {
    if (isWebUI || !window.fello) return;
    return window.fello.updateTheme(theme);
  },
  onMacFullScreen: (callback: (isFullScreen: boolean) => void) => {
    if (isWebUI || !window.fello) return () => {};
    const handler = (isFullScreen: boolean) => callback(isFullScreen);
    return window.fello.onMacFullScreen(handler);
  },
  onUpdater: (callback: (updaterEvent: UpdaterEvent) => void) => {
    if (isWebUI || !window.fello) return () => {};
    const handler = (updaterEvent: UpdaterEvent) => callback(updaterEvent);
    return window.fello.onUpdater(handler);
  },

  /**
   * 外设（Electron 专属）。
   *
   * WebUI 下所有方法都是 no-op / 空数组：外设运行时只在桌面应用里装载，
   * 设置页据此显示「仅桌面应用可用」。
   */
  peripherals: {
    /**
     * 打开系统的「输入监控」隐私面板：权限状态无法查询，且用户拒绝过之后系统不会再弹窗
     * （首次打开 HID 设备时系统本来就会弹），所以给一个由用户主动点的直达入口。
     */
    openPermissionSettings: async (): Promise<void> => {
      if (isWebUI || !window.fello) return;
      return window.fello.invoke("openPeripheralPermissionSettings");
    },
    getStatuses: async (): Promise<PeripheralStatus[]> => {
      if (isWebUI || !window.fello) return [];
      return window.fello.invoke("getPeripheralStatuses");
    },
    connect: async (peripheralId: string): Promise<void> => {
      if (isWebUI || !window.fello) return;
      return window.fello.invoke("peripheralConnect", peripheralId);
    },
    /** @returns captureId：用于过滤属于上一次采集的迟到音频帧。 */
    voiceStart: async (peripheralId: string): Promise<number> => {
      if (isWebUI || !window.fello) return 0;
      return window.fello.invoke("peripheralVoiceStart", peripheralId);
    },
    voiceStop: async (peripheralId: string): Promise<void> => {
      if (isWebUI || !window.fello) return;
      return window.fello.invoke("peripheralVoiceStop", peripheralId);
    },
  },
};
