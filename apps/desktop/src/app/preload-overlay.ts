import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("overlay", {
  on: (cb: (msg: unknown) => void) => ipcRenderer.on("overlay", (_e, m) => cb(m)),
});
