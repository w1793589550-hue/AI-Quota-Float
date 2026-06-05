const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quotaApp", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  updateProvider: (id, patch) => ipcRenderer.invoke("app:update-provider", id, patch),
  updateAppearance: (patch) => ipcRenderer.invoke("app:update-appearance", patch),
  updateAutoRefresh: (patch) => ipcRenderer.invoke("app:update-auto-refresh", patch),
  setMode: (mode) => ipcRenderer.invoke("app:set-mode", mode),
  resizePanel: (width, height) => ipcRenderer.invoke("app:resize-panel", width, height),
  moveWindow: (dx, dy) => ipcRenderer.invoke("app:move-window", dx, dy),
  requestClose: () => ipcRenderer.invoke("app:request-close"),
  minimizeToTray: () => ipcRenderer.invoke("app:minimize-to-tray"),
  quitNow: () => ipcRenderer.invoke("app:quit-now"),
  refresh: (id) => ipcRenderer.invoke("quota:refresh", id),
  refreshAll: () => ipcRenderer.invoke("quota:refresh-all"),
  onModeChanged: (callback) => ipcRenderer.on("mode-changed", (_event, mode) => callback(mode)),
  onCloseChoiceRequested: (callback) => ipcRenderer.on("close-choice-requested", () => callback())
});
