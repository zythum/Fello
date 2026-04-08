import { isWebUI } from "./backend";

export const electron = {
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
};
