import type { FelloIPCSchema } from "../backend/ipc-schema";

// --- Typed event emitter ---

type BackendEvents = FelloIPCSchema["events"];

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

type ElectronRequests = {
  showOpenDialog: { params: void; response: string | null };
  revealInFinder: { params: string; response: void };
  openInBrowser: { params: string; response: void };
  trashFile: { params: string; response: void };
};

type AllRequests = Requests & ElectronRequests;

type RequestClient = {
  [K in keyof AllRequests]: (
    params: AllRequests[K]["params"],
  ) => Promise<AllRequests[K]["response"]>;
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

let ws: WebSocket | null = null;
let wsReadyPromise: Promise<void> | null = null;
let msgId = 0;
const wsCallbacks = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

if (isWebUI) {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");
  const wsPort = urlParams.get("wsPort") || window.location.port;

  if (token) {
    const wsUrl = `ws://${window.location.hostname}:${wsPort}/?token=${token}`;
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

export const request = new Proxy(
  {},
  {
    get(_target, prop) {
      return async (params: unknown) => {
        if (isWebUI && ws) {
          await wsReadyPromise;
          return new Promise((resolve, reject) => {
            const id = ++msgId;
            wsCallbacks.set(id, { resolve, reject });
            ws!.send(JSON.stringify({ type: "request", id, channel: prop, params }));
          });
        }
        return bridge.invoke(prop as any, params as never);
      };
    },
  },
) as RequestClient;

export const subscribe = { on, off };

bridge.on("session-update", (payload) => emit("session-update", payload));
bridge.on("permission-request", (payload) => emit("permission-request", payload));
bridge.on("terminal-output", (payload) => emit("terminal-output", payload));
bridge.on("terminal-exit", (payload) => emit("terminal-exit", payload));
bridge.on("fs-changed", (payload) => emit("fs-changed", payload));
