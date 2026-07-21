import { isWebUI } from "./backend";
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
};
