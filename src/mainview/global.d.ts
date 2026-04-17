import type { FelloIPCSchema } from "../shared/schema";

export type ElectronIPCRequests = {
  showOpenDialog: { params: void; response: string | null };
  revealInFinder: { params: string; response: void };
  openInBrowser: { params: string; response: void };
  trashFile: { params: string; response: void };
};

export type AllIPCRequests = FelloIPCSchema["requests"] & ElectronIPCRequests;

declare global {
  interface Window {
    fello?: {
      isMacApp: boolean;
      onMacFullScreen?: (callback: (isFullScreen: boolean) => void) => () => void;
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
