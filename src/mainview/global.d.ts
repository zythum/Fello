import type { FelloIPCSchema } from "../shared/schema";

declare global {
  interface Window {
    fello: {
      invoke<K extends keyof FelloIPCSchema["requests"]>(
        channel: K,
        params: FelloIPCSchema["requests"][K]["params"],
      ): Promise<FelloIPCSchema["requests"][K]["response"]>;
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

export {};
