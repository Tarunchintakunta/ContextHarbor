import { contextBridge, ipcRenderer } from "electron";

const call = (ch: string) => (...a: unknown[]) => ipcRenderer.invoke(`settings:${ch}`, ...a);
contextBridge.exposeInMainWorld("api", {
  get: call("get"), patch: call("patch"), switchUser: call("switchUser"), meetings: call("meetings"), meeting: call("meeting"),
  exportMeeting: call("exportMeeting"), deleteMeeting: call("deleteMeeting"), history: call("history"), setApiKey: call("setApiKey"),
  openKb: call("openKb"), wipe: call("wipe"),
});
