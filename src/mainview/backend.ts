import type { SessionNotification, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { FelloIPCSchema } from "../electron/ipc-schema";

// --- Typed event emitter ---

interface BackendEvents {
  "session-update": SessionNotification;
  "permission-request": RequestPermissionRequest;
}

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
  [K in keyof Requests]: (
    params: Requests[K]["params"],
  ) => Promise<Requests[K]["response"]>;
};

const fallbackBridge = {
  invoke: async () => {
    throw new Error("Electron bridge is not available");
  },
  on: () => {},
  off: () => {},
};

const bridge = window.fello ?? fallbackBridge;

export const request = new Proxy(
  {},
  {
    get(_target, prop) {
      return (params: unknown) => bridge.invoke(prop as keyof Requests, params as never);
    },
  },
) as RequestClient;

export const subscribe = { on, off };

bridge.on("session-update", (payload) => emit("session-update", payload));
bridge.on("permission-request", (payload) => emit("permission-request", payload));
