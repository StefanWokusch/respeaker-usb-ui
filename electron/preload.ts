import { contextBridge, ipcRenderer } from "electron";

import type { ReSpeakerApi } from "../src/shared/types";

const api: ReSpeakerApi = {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  refreshDashboard: () => ipcRenderer.invoke("device:refresh-dashboard"),
  refreshPreview: () => ipcRenderer.invoke("device:refresh-preview"),
  refreshSignals: () => ipcRenderer.invoke("device:refresh-signals"),
  refreshLive: () => ipcRenderer.invoke("device:refresh-live"),
  refreshLiveDetails: () => ipcRenderer.invoke("device:refresh-live-details"),
  refreshCommands: (force) =>
    ipcRenderer.invoke("device:refresh-commands", Boolean(force)),
  readCommand: (name) => ipcRenderer.invoke("device:read-command", name),
  readCommands: (names) => ipcRenderer.invoke("device:read-commands", names),
  writeCommand: (payload) =>
    ipcRenderer.invoke("device:write-command", payload),
  setBinaryPath: (binaryPath) =>
    ipcRenderer.invoke("device:set-binary-path", binaryPath),
  browseBinaryPath: () => ipcRenderer.invoke("device:browse-binary-path"),
  setRoomMode: () => ipcRenderer.invoke("device:set-room-mode"),
  setFixedMode: () => ipcRenderer.invoke("device:set-fixed-mode"),
  setFixedBeamWindow: (payload) =>
    ipcRenderer.invoke("device:set-fixed-beam-window", payload),
  saveConfiguration: () => ipcRenderer.invoke("device:save-configuration"),
  clearConfiguration: () => ipcRenderer.invoke("device:clear-configuration"),
  reboot: () => ipcRenderer.invoke("device:reboot")
};

contextBridge.exposeInMainWorld("respeakerApi", api);
