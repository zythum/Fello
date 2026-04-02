import { contextBridge, ipcRenderer } from "electron";
import type { FelloIPCSchema } from "./ipc-schema";

type EventName = keyof FelloIPCSchema["events"];
type EventPayload<K extends EventName> = FelloIPCSchema["events"][K];
type EventListener<K extends EventName> = (payload: EventPayload<K>) => void;

const wrappedListeners = new Map<
  EventName,
  WeakMap<EventListener<any>, (_event: unknown, payload: unknown) => void>
>();

contextBridge.exposeInMainWorld("fello", {
  invoke<K extends keyof FelloIPCSchema["requests"]>(
    channel: K,
    params: FelloIPCSchema["requests"][K]["params"],
  ) {
    return ipcRenderer.invoke(channel, params) as Promise<FelloIPCSchema["requests"][K]["response"]>;
  },
  on<K extends EventName>(channel: K, listener: EventListener<K>) {
    if (!wrappedListeners.has(channel)) wrappedListeners.set(channel, new WeakMap());
    const map = wrappedListeners.get(channel)!;
    const wrapped = (_event: unknown, payload: unknown) => {
      listener(payload as EventPayload<K>);
    };
    map.set(listener, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  off<K extends EventName>(channel: K, listener: EventListener<K>) {
    const map = wrappedListeners.get(channel);
    const wrapped = map?.get(listener);
    if (!wrapped) return;
    ipcRenderer.removeListener(channel, wrapped);
    map?.delete(listener);
  },
});
