import type { FelloIPCSchema } from "../shared/schema";
import { generateUUID } from "./lib/utils";

// --- Typed event emitter ---

export type BackendEvents = FelloIPCSchema["events"];

type Listener<T> = (data: T) => void;

const listeners = new Map<string, Set<Listener<any>>>();

function on<K extends keyof BackendEvents>(event: K, fn: Listener<BackendEvents[K]>) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
}

function off<K extends keyof BackendEvents>(event: K, fn: Listener<BackendEvents[K]>) {
  listeners.get(event)?.delete(fn);
}

function emit<K extends keyof BackendEvents>(event: K, data: BackendEvents[K]) {
  listeners.get(event)?.forEach((fn) => fn(data));
}

// --- Public API ---

type Requests = FelloIPCSchema["requests"];

type RequestClient = {
  [K in keyof Requests]: (params: Requests[K]["params"]) => Promise<Requests[K]["response"]>;
};

const fallbackBridge = {
  invoke: async () => {
    throw new Error("Electron bridge is not available");
  },
  on: () => {},
  off: () => {},
};

export const isWebUI = typeof window.fello === "undefined";
const bridge = window.fello ?? fallbackBridge;

export const clientId = generateUUID();

/**
 * WebUI 模式下的 HTTP base URL（如 http://192.168.1.100:9090）。
 * Electron 模式下为 null。
 * 可直接用于拼接文件服务 URL，无需走 React store。
 */
export const webUIBaseUrl: string | null = (() => {
  if (!isWebUI) return null;
  const port = new URLSearchParams(window.location.search).get("port") || window.location.port;
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
})();

let ws: WebSocket | null = null;
let wsReadyPromise: Promise<void> | null = null;
let msgId = 0;
const wsCallbacks = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

if (isWebUI) {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");
  const port = urlParams.get("port") || window.location.port;

  if (token) {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:${port}/?token=${token}`;
    ws = new WebSocket(wsUrl);

    wsReadyPromise = new Promise((resolve, reject) => {
      ws!.onopen = () => resolve();
      ws!.onerror = (err) => reject(err);
    });

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "event") {
          emit(msg.channel, msg.payload);
        } else if (msg.type === "response") {
          const cb = wsCallbacks.get(msg.id);
          if (cb) {
            if (msg.error) cb.reject(new Error(msg.error));
            else cb.resolve(msg.response);
            wsCallbacks.delete(msg.id);
          }
        }
      } catch (err) {
        console.error("Failed to parse WS message", err);
      }
    };
  } else {
    console.error("WebUI mode: No token found in URL");
  }
}

async function invokeIPC(channel: unknown, params?: unknown): Promise<unknown> {
  if (isWebUI && ws) {
    await wsReadyPromise;
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      wsCallbacks.set(id, { resolve, reject });
      ws!.send(JSON.stringify({ type: "request", id, channel, params }));
    });
  }
  // @ts-ignore
  return bridge.invoke(channel, params);
}

export const request = new Proxy(
  {},
  {
    get(_target, prop) {
      return (params: unknown) => invokeIPC(prop, params);
    },
  },
) as RequestClient;

export const subscribe = { on, off };

bridge.on("session-changed", (payload) => emit("session-changed", payload));
bridge.on("session-update", (payload) => emit("session-update", payload));
bridge.on("ask-user-request", (payload) => emit("ask-user-request", payload));
bridge.on("ask-user-response", (payload) => emit("ask-user-response", payload));
bridge.on("terminal-output", (payload) => emit("terminal-output", payload));
bridge.on("terminal-exit", (payload) => emit("terminal-exit", payload));
bridge.on("agent-terminal-output", (payload) => emit("agent-terminal-output", payload));
bridge.on("webui-status-changed", (payload) => emit("webui-status-changed", payload));
bridge.on("fs-changed", (payload) => emit("fs-changed", payload));
bridge.on("projects-changed", (payload) => emit("projects-changed", payload));
bridge.on("sessions-changed", (payload) => emit("sessions-changed", payload));
bridge.on("ilink-status-changed", (payload) => emit("ilink-status-changed", payload));
bridge.on("ilink-active-session-changed", (payload) =>
  emit("ilink-active-session-changed", payload),
);
bridge.on("prompt-start", (payload) => emit("prompt-start", payload));
bridge.on("prompt-end", (payload) => emit("prompt-end", payload));
bridge.on("schedules-changed", (payload) => emit("schedules-changed", payload));
bridge.on("task-update", (payload) => emit("task-update", payload));
// Register client identity
void invokeIPC("registerClient", { clientId }).catch(() => {});
