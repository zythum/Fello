import { Electroview } from "electrobun/view";
import type { CoworkRPCSchema } from "../bun/rpc-schema";
import type { SessionNotification, RequestPermissionRequest } from "@agentclientprotocol/sdk";

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

// --- RPC instance ---

const rpcInstance = Electroview.defineRPC<CoworkRPCSchema>({
  maxRequestTime: Infinity,
  handlers: {
    requests: {
      async onSessionUpdate(jsonStr: unknown) {
        emit("session-update", JSON.parse(jsonStr as string));
        return { ok: true };
      },
      async onPermissionRequest(jsonStr: unknown) {
        emit("permission-request", JSON.parse(jsonStr as string));
        return { ok: true };
      },
    },
  },
});

new Electroview({ rpc: rpcInstance });

// --- Public API ---

export const request = rpcInstance.request;
export const subscribe = { on, off };
