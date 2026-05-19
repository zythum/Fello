import type { FelloIPCSchema } from "../shared/schema";
import type { UpdaterEvent } from "../electron/updater";

export type ElectronIPCRequests = {
  showOpenDialog: { params: void; response: string | null };
  revealInFinder: { params: string; response: void };
  openInBrowser: { params: string; response: void };
  trashFile: { params: string; response: void };
  getUpdaterStatus: { params: void; response: UpdaterEvent | null };
  checkForUpdates: { params: { manual?: boolean } | void; response: void };
  downloadUpdate: { params: void; response: void };
  installUpdate: { params: void; response: void };
};

export type AllIPCRequests = FelloIPCSchema["requests"] & ElectronIPCRequests;

declare global {
  interface Window {
    fello?: {
      isMacApp: boolean;
      onMacFullScreen: (callback: (isFullScreen: boolean) => void) => () => void;
      onUpdater: (callback: (updaterEvent: UpdaterEvent) => void) => () => void;

      invoke<K extends keyof AllIPCRequests>(
        channel: K,
        params?: AllIPCRequests[K]["params"],
      ): Promise<AllIPCRequests[K]["response"]>;
      on<K extends keyof FelloIPCSchema["events"]>(
        channel: K,
        listener: (payload: FelloIPCSchema["events"][K]) => void,
      ): void;
      off<K extends keyof FelloIPCSchema["events"]>(
        channel: K,
        listener: (payload: FelloIPCSchema["events"][K]) => void,
      ): void;
    };
  }
}

declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: "drag" | "no-drag";
  }
}

// Vite 显式资源导入：让 TypeScript 认识 ?url 和 ?worker 后缀
declare module "*?url" {
  const url: string;
  export default url;
}

declare module "*?worker" {
  const workerConstructor: { new (): Worker };
  export default workerConstructor;
}
