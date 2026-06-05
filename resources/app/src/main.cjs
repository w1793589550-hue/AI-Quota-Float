const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const providers = [
  { id: "deepseek", name: "DeepSeek", mode: "balance", capability: "真实余额", unit: "CNY", baseUrl: "https://api.deepseek.com", limit: 100, remaining: 72 },
  { id: "openai", name: "OpenAI", mode: "usage", capability: "用量/成本", unit: "USD", baseUrl: "https://api.openai.com/v1", limit: 50, remaining: 24 },
  { id: "anthropic", name: "Anthropic", mode: "usage", capability: "用量/成本", unit: "USD", baseUrl: "https://api.anthropic.com/v1", limit: 50, remaining: 26 }
];

let win;
let tray;
let isQuitting = false;
let deerTimer;
let desktopIconRects = [];
let deerLane = null;
let deerPausedUntil = 0;
let state = {
  mode: "panel",
  panelSize: { width: 330, height: 470 },
  appearance: { deerColor: "sky", theme: "light" },
  autoRefresh: { enabled: false, intervalMinutes: 30 },
  lastRefresh: "",
  providers: Object.fromEntries(providers.map((provider) => [
    provider.id,
    {
      enabled: ["deepseek"].includes(provider.id),
      apiKeyEncrypted: "",
      baseUrl: provider.baseUrl,
      limit: provider.limit,
      remaining: provider.remaining,
      manualLimit: false,
      status: provider.mode === "balance" ? "未连接" : "待接入"
    }
  ]))
};

function statePath() {
  return path.join(app.getPath("userData"), "quota-state.json");
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    state = {
      ...state,
      ...saved,
      appearance: {
        ...state.appearance,
        ...(saved.appearance || {})
      },
      autoRefresh: {
        ...state.autoRefresh,
        ...(saved.autoRefresh || {})
      },
      providers: {
        ...state.providers,
        ...(saved.providers || {})
      }
    };
    migrateSecrets();
  } catch {
    saveState();
  }
}

function saveState() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf8");
}

function migrateSecrets() {
  let changed = false;
  for (const cfg of Object.values(state.providers)) {
    if (cfg.apiKey) {
      cfg.apiKeyEncrypted = encryptSecret(cfg.apiKey);
      delete cfg.apiKey;
      changed = true;
    }
  }
  if (changed) saveState();
}

function encryptSecret(value) {
  if (!value) return "";
  if (safeStorage.isEncryptionAvailable()) {
    return `safe:${safeStorage.encryptString(String(value)).toString("base64")}`;
  }
  return `plain:${Buffer.from(String(value), "utf8").toString("base64")}`;
}

function decryptSecret(value) {
  if (!value) return "";
  try {
    if (String(value).startsWith("safe:")) {
      return safeStorage.decryptString(Buffer.from(String(value).slice(5), "base64"));
    }
    if (String(value).startsWith("plain:")) {
      return Buffer.from(String(value).slice(6), "base64").toString("utf8");
    }
    return String(value);
  } catch {
    return "";
  }
}

function providerApiKey(id) {
  return decryptSecret(state.providers[id]?.apiKeyEncrypted || "");
}

function publicState() {
  return {
    ...state,
    providers: Object.fromEntries(Object.entries(state.providers).map(([id, cfg]) => [
      id,
      {
        ...cfg,
        apiKey: "",
        apiKeyEncrypted: undefined,
        hasApiKey: Boolean(providerApiKey(id))
      }
    ]))
  };
}

function createWindow() {
  loadState();
  const panelSize = normalizePanelSize(state.panelSize);
  win = new BrowserWindow({
    width: panelSize.width,
    height: panelSize.height,
    x: screen.getPrimaryDisplay().workArea.width - 400,
    y: 120,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 300,
    minHeight: 380,
    maxWidth: 460,
    maxHeight: 720,
    movable: true,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    backgroundMaterial: "acrylic",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "renderer.html"));
  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    requestCloseChoice();
  });
  win.once("ready-to-show", () => {
    applyMode(state.mode || "panel");
    win.show();
  });

  createTray();
  refreshDesktopIcons();
  setInterval(refreshDesktopIcons, 30000);
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, "..", "assets", "deer-mascot.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip("AI 额度悬浮窗");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示悬浮窗", click: showWindow },
    { label: "最小化到托盘", click: hideToTray },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("click", showWindow);
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function hideToTray() {
  if (!win) return;
  win.hide();
}

async function requestCloseChoice() {
  if (!win) return;
  win.show();
  win.webContents.send("close-choice-requested");
}

function applyMode(mode) {
  if (!win) return;
  state.mode = mode;
  saveState();
  stopDeerRun();

  const bounds = win.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  const panelSize = normalizePanelSize(state.panelSize);

  if (mode === "panel") {
    win.setIgnoreMouseEvents(false);
    win.setResizable(true);
    win.setBounds(clampBounds({ x: bounds.x, y: bounds.y, width: panelSize.width, height: panelSize.height }, work), true);
  }

  if (mode === "collapsed") {
    win.setIgnoreMouseEvents(false);
    win.setResizable(false);
    win.setBounds(clampBounds({ x: bounds.x, y: bounds.y, width: 286, height: 54 }, work), true);
  }

  if (mode === "deer") {
    win.setIgnoreMouseEvents(false);
    win.setResizable(false);
    const next = clampBounds({ x: bounds.x, y: bounds.y, width: 190, height: 148 }, work);
    win.setBounds(next, true);
    deerLane = makeDeerLane(next, work);
    startDeerRun();
  }

  win.webContents.send("mode-changed", mode);
}

function normalizePanelSize(size = {}) {
  return {
    width: Math.max(300, Math.min(460, Math.round(Number(size.width) || 330))),
    height: Math.max(380, Math.min(720, Math.round(Number(size.height) || 470)))
  };
}

function clampBounds(bounds, work) {
  return {
    ...bounds,
    x: Math.max(work.x + 8, Math.min(bounds.x, work.x + work.width - bounds.width - 8)),
    y: Math.max(work.y + 8, Math.min(bounds.y, work.y + work.height - bounds.height - 8))
  };
}

function startDeerRun() {
  if (deerTimer) return;
  deerTimer = setInterval(() => {
    if (!win || state.mode !== "deer") return;
    if (Date.now() < deerPausedUntil) return;
    const bounds = win.getBounds();
    const work = screen.getDisplayMatching(bounds).workArea;
    if (!deerLane || bounds.x < deerLane.left - 16 || bounds.x > deerLane.right + 16) {
      deerLane = makeDeerLane(bounds, work);
    }

    const speed = 0.62;
    let nextX = bounds.x + deerLane.direction * speed;
    if (nextX >= deerLane.right) {
      nextX = deerLane.right;
      deerLane.direction = -1;
    }
    if (nextX <= deerLane.left) {
      nextX = deerLane.left;
      deerLane.direction = 1;
    }
    const next = clampBounds({
      x: Math.round(nextX),
      y: deerLane.y,
      width: bounds.width,
      height: bounds.height
    }, work);
    win.setBounds(next, false);
  }, 96);
}

function stopDeerRun() {
  if (deerTimer) clearInterval(deerTimer);
  deerTimer = null;
}

function makeDeerLane(bounds, work) {
  const laneWidth = Math.min(620, Math.max(260, Math.round(work.width * 0.34)));
  const center = bounds.x + bounds.width / 2;
  const left = Math.max(work.x + 12, Math.min(center - laneWidth / 2, work.x + work.width - laneWidth - 12));
  const right = Math.min(work.x + work.width - bounds.width - 12, left + laneWidth);
  return {
    left: Math.round(left),
    right: Math.round(Math.max(left, right)),
    y: Math.max(work.y + 12, Math.min(bounds.y, work.y + work.height - bounds.height - 12)),
    direction: Math.random() > 0.5 ? 1 : -1
  };
}

function intersects(a, b) {
  return a.left < b.x + b.width && a.right > b.x && a.top < b.y + b.height && a.bottom > b.y;
}

function padRect(rect, pad) {
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    right: rect.right + pad,
    bottom: rect.bottom + pad
  };
}

function refreshDesktopIcons() {
  const script = path.join(__dirname, "..", "scripts", "get-desktop-icons.ps1");
  const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    windowsHide: true
  });
  let out = "";
  ps.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
  ps.on("close", () => {
    try {
      const parsed = JSON.parse(out.trim() || "[]");
      desktopIconRects = Array.isArray(parsed) ? parsed : [];
    } catch {
      desktopIconRects = [];
    }
  });
}

async function fetchDeepSeekBalance(config) {
  const baseUrl = String(config.baseUrl || "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/user/balance`, {
    headers: { Authorization: `Bearer ${providerApiKey("deepseek")}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || `${response.status} ${response.statusText}`);
  const total = Array.isArray(data.balance_infos)
    ? data.balance_infos.reduce((sum, item) => sum + Number(item.total_balance || 0), 0)
    : 0;
  return {
    remaining: Number(total.toFixed(2)),
    status: data.is_available === false ? "不可用" : "可用"
  };
}

ipcMain.handle("app:get-state", () => ({ state: publicState(), providers }));

ipcMain.handle("app:update-provider", (_event, id, patch) => {
  const nextPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, "apiKey")) {
    const key = String(nextPatch.apiKey || "");
    delete nextPatch.apiKey;
    if (key) nextPatch.apiKeyEncrypted = encryptSecret(key);
  }
  state.providers[id] = { ...state.providers[id], ...nextPatch };
  if (Object.prototype.hasOwnProperty.call(patch, "limit")) state.providers[id].manualLimit = true;
  saveState();
  return publicState();
});

ipcMain.handle("app:update-appearance", (_event, patch) => {
  state.appearance = { ...state.appearance, ...patch };
  saveState();
  return publicState();
});

ipcMain.handle("app:update-auto-refresh", (_event, patch) => {
  const interval = Number(patch.intervalMinutes || state.autoRefresh.intervalMinutes || 30);
  state.autoRefresh = {
    enabled: Boolean(patch.enabled),
    intervalMinutes: [5, 30, 60].includes(interval) ? interval : 30
  };
  saveState();
  return publicState();
});

ipcMain.handle("app:set-mode", (_event, mode) => {
  applyMode(mode);
  return state.mode;
});

ipcMain.handle("app:resize-panel", (_event, width, height) => {
  if (!win) return state.panelSize;
  state.panelSize = normalizePanelSize({ width, height });
  const bounds = win.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  if (state.mode === "panel") {
    win.setBounds(clampBounds({ ...bounds, ...state.panelSize }, work), false);
  }
  saveState();
  return state.panelSize;
});

ipcMain.handle("app:move-window", (_event, dx, dy) => {
  if (!win) return;
  const bounds = win.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  const next = clampBounds({
    ...bounds,
    x: Math.round(bounds.x + Number(dx || 0)),
    y: Math.round(bounds.y + Number(dy || 0))
  }, work);
  win.setBounds(next, false);
  deerPausedUntil = Date.now() + 1800;
  if (state.mode === "deer") deerLane = makeDeerLane(next, work);
});

ipcMain.handle("app:request-close", () => {
  requestCloseChoice();
});

ipcMain.handle("app:minimize-to-tray", () => {
  hideToTray();
});

ipcMain.handle("app:quit-now", () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle("quota:refresh", async (_event, id) => {
  const provider = providers.find((item) => item.id === id);
  const config = state.providers[id];
  if (!provider || !config) return state;
  if (provider.mode === "usage") {
    config.status = providerApiKey(id) ? "用量API" : "未配置";
    state.lastRefresh = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    saveState();
    return publicState();
  }
  if (!providerApiKey(id)) {
    config.status = "未配置";
    saveState();
    return state;
  }

  try {
    const result = await fetchDeepSeekBalance(config);
    config.remaining = result.remaining;
    if (!config.manualLimit) config.limit = Math.max(result.remaining, 1);
    config.status = result.status;
  } catch (error) {
    config.status = "失败";
    config.error = error.message;
  }
  state.lastRefresh = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  saveState();
  return publicState();
});

ipcMain.handle("quota:refresh-all", async () => {
  for (const provider of providers) {
    if (state.providers[provider.id]?.enabled) {
      if (provider.mode === "balance") {
        try {
          const result = await fetchDeepSeekBalance(state.providers[provider.id]);
          state.providers[provider.id].remaining = result.remaining;
          if (!state.providers[provider.id].manualLimit) state.providers[provider.id].limit = Math.max(result.remaining, 1);
          state.providers[provider.id].status = result.status;
        } catch (error) {
          state.providers[provider.id].status = "失败";
          state.providers[provider.id].error = error.message;
        }
      } else {
        state.providers[provider.id].status = providerApiKey(provider.id) ? "用量API" : "未配置";
      }
    }
  }
  state.lastRefresh = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  saveState();
  return publicState();
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (isQuitting && process.platform !== "darwin") app.quit();
});
