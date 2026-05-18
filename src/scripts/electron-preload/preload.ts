import { contextBridge, ipcRenderer } from "electron";
import type { FelloIPCSchema } from "../../shared/schema";
import type { UpdaterEvent } from "../../electron/updater";

type ElectronIPCRequests = {
  showOpenDialog: { params: void; response: string | null };
  revealInFinder: { params: string; response: void };
  openInBrowser: { params: string; response: void };
  trashFile: { params: string; response: void };
  getUpdaterStatus: { params: void; response: UpdaterEvent | null };
  checkForUpdates: { params: { manual?: boolean } | void; response: void };
  downloadUpdate: { params: void; response: void };
  installUpdate: { params: void; response: void };
};

type AllIPCRequests = FelloIPCSchema["requests"] & ElectronIPCRequests;

type EventName = keyof FelloIPCSchema["events"];
type EventPayload<K extends EventName> = FelloIPCSchema["events"][K];
type EventListener<K extends EventName> = (payload: EventPayload<K>) => void;

const wrappedListeners = new Map<
  EventName,
  WeakMap<EventListener<any>, (_event: unknown, payload: unknown) => void>
>();

contextBridge.exposeInMainWorld("fello", {
  isMacApp: process.platform === "darwin",
  onMacFullScreen: (callback: (isFullScreen: boolean) => void) => {
    const handler = (_event: unknown, isFullScreen: boolean) => callback(isFullScreen);
    ipcRenderer.on("electron:mac-fullscreen", handler);
    return () => ipcRenderer.removeListener("electron:mac-fullscreen", handler);
  },
  onUpdater: (callback: (updaterEvent: UpdaterEvent) => void) => {
    const handler = (_event: unknown, updaterEvent: UpdaterEvent) => callback(updaterEvent);
    ipcRenderer.on("electron:updater-event", handler);
    return () => ipcRenderer.removeListener("electron:updater-event", handler);
  },
  invoke<K extends keyof AllIPCRequests>(channel: K, params?: AllIPCRequests[K]["params"]) {
    return ipcRenderer.invoke(channel, params) as Promise<AllIPCRequests[K]["response"]>;
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
