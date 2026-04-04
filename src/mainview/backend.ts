import type { FelloIPCSchema } from "../backend/backend";

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

const bridge = window.fello ?? fallbackBridge;

export const request = new Proxy(
  {},
  {
    get(_target, prop) {
      return (params: unknown) => bridge.invoke(prop as any, params as never);
    },
  },
) as RequestClient;

export const subscribe = { on, off };

bridge.on("session-update", (payload) => emit("session-update", payload));
bridge.on("permission-request", (payload) => emit("permission-request", payload));
bridge.on("terminal-output", (payload) => emit("terminal-output", payload));
bridge.on("terminal-exit", (payload) => emit("terminal-exit", payload));
