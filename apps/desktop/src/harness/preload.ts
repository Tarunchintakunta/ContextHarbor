import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("harbor", {
  command: (cmd: "toggle-visible" | "toggle-pause" | "quit") => ipcRenderer.send("command", cmd),
  onState: (cb: (s: unknown) => void) => ipcRenderer.on("state", (_e, s) => cb(s)),
});
