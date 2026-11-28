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

/**
 * 请求来源，由分发点或调用方注入（客户端无法伪造）：
 * - `ipc`：桌面渲染层
 * - `webui`：WebUI / WS
 * - `internal`：进程内直接调用（例如 server 启动 WebUI）
 */
export interface BackendRequestContext {
  transport: "ipc" | "webui" | "internal";
}

export type BackendHandlers = {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
    ctx: BackendRequestContext,
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
};
