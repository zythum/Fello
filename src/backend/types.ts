import type { FelloIPCSchema } from "../shared/schema";
import type { storageOps } from "./storage";

export type SendEventFn = <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean;

export type EventListener = <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => void;

export interface BackendContext {
  sendEvent: SendEventFn;
  onEvent: (listener: EventListener) => void;
  storage: typeof storageOps;
}

export type BackendHandlers = {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
};
