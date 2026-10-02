import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("capture", {
  on: (cb: (msg: { cmd: "start" | "stop" }) => void) => ipcRenderer.on("capture", (_e, m) => cb(m)),
  frame: (channel: "remote" | "me", buf: ArrayBuffer) => ipcRenderer.send("capture:frame", channel, buf),
  status: (s: string) => ipcRenderer.send("capture:status", s),
});
