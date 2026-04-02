import { contextBridge, ipcRenderer } from "electron";
const wrappedListeners = /* @__PURE__ */ new Map();
contextBridge.exposeInMainWorld("fello", {
  invoke(channel, params) {
    return ipcRenderer.invoke(channel, params);
  },
  on(channel, listener) {
    if (!wrappedListeners.has(channel)) wrappedListeners.set(channel, /* @__PURE__ */ new WeakMap());
    const map = wrappedListeners.get(channel);
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    map.set(listener, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  off(channel, listener) {
    const map = wrappedListeners.get(channel);
    const wrapped = map?.get(listener);
    if (!wrapped) return;
    ipcRenderer.removeListener(channel, wrapped);
    map?.delete(listener);
  }
});
