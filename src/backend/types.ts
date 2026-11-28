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

/** 请求来源：`ipc` = 桌面渲染层；`webui` = 通过 WebUI 的浏览器 / 服务器。 */
export interface BackendRequestContext {
  transport: "ipc" | "webui";
}

export type BackendHandlers = {
  [K in keyof FelloIPCSchema["requests"]]: (
    params: FelloIPCSchema["requests"][K]["params"],
    /** 进程内直接调用（例如 server 启动 WebUI）时不传。 */
    ctx?: BackendRequestContext,
  ) => Promise<FelloIPCSchema["requests"][K]["response"]>;
};
