let appState = null;
let providers = [];
const expandedSettings = new Set(["deepseek"]);
const deerColors = [
  { id: "sky", name: "天空蓝" },
  { id: "black", name: "黑色" },
  { id: "white", name: "白色" },
  { id: "mint", name: "薄荷绿" },
  { id: "amber", name: "暖黄色" },
  { id: "rose", name: "玫瑰粉" }
];

const body = document.body;
const quotaList = document.getElementById("quotaList");
const barSummary = document.getElementById("barSummary");
const settingsList = document.getElementById("settingsList");
const settingsView = document.getElementById("settingsView");
const deerBubble = document.getElementById("deerBubble");
const resizeHandle = document.getElementById("resizeHandle");
const deerBody = document.getElementById("deerBody");
const appearanceSettings = document.getElementById("appearanceSettings");
const autoRefreshSettings = document.getElementById("autoRefreshSettings");
const closeChoiceView = document.getElementById("closeChoiceView");
let autoRefreshTimer = null;

function formatNumber(value) {
  const num = Number(value || 0);
  if (num >= 1000000) return `${(num / 1000000).toFixed(num >= 10000000 ? 0 : 1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}K`;
  return Number.isInteger(num) ? new Intl.NumberFormat("zh-CN").format(num) : num.toFixed(2);
}

function percentFor(id) {
  const item = appState.providers[id];
  const limit = Math.max(Number(item.limit || 0), 1);
  return Math.max(0, Math.min(100, Number(item.remaining || 0) / limit * 100));
}

function enabledItems() {
  return providers
    .filter((provider) => appState.providers[provider.id]?.enabled)
    .map((provider) => ({
      provider,
      cfg: appState.providers[provider.id],
      pct: percentFor(provider.id)
    }));
}

function render() {
  const items = enabledItems();
  applyTheme();
  applyDeerColor();
  barSummary.textContent = `${items.length} 项`;
  quotaList.innerHTML = items.length ? items.map(({ provider, cfg, pct }) => `
    <article class="quota-card ${pct <= 20 ? "low" : ""}">
      <div class="quota-card-head">
        <div>
          <strong>${escapeHtml(provider.name)}</strong>
          <span>${escapeHtml(cfg.status || "手动")} · ${escapeHtml(provider.unit)}</span>
        </div>
        <b>${Math.round(pct)}%</b>
      </div>
      <div class="meter"><span style="width:${pct}%"></span></div>
      <div class="quota-meta">
        <span>剩余 ${formatNumber(cfg.remaining)}</span>
        <span>上限 ${formatNumber(cfg.limit)}</span>
      </div>
    </article>
  `).join("") : `
    <article class="quota-card">
      <div class="quota-card-head">
        <div>
          <strong>未启用模型</strong>
          <span>打开设置添加 API Key</span>
        </div>
        <b>0%</b>
      </div>
      <div class="meter"><span style="width:0%"></span></div>
      <div class="quota-meta"><span>暂无额度面板</span><span>0 项</span></div>
    </article>
  `;

  const lows = items.filter((item) => item.pct <= 20);
  if (lows.length) {
    deerBubble.hidden = false;
    deerBubble.innerHTML = `<strong>额度预警</strong><ul>${lows.map(({ provider, cfg, pct }) =>
      `<li>${escapeHtml(provider.name)} 仅剩 ${Math.round(pct)}%，余量 ${formatNumber(cfg.remaining)} ${escapeHtml(provider.unit)}</li>`
    ).join("")}</ul>`;
  } else {
    deerBubble.hidden = true;
  }

  renderSettings();
}

function renderSettings() {
  renderAppearanceSettings();
  renderAutoRefreshSettings();
  settingsList.innerHTML = providers.map((provider) => {
    const cfg = appState.providers[provider.id];
    const open = expandedSettings.has(provider.id);
    return `
      <section class="setting-row ${open ? "open" : ""}" data-provider="${provider.id}">
        <div class="setting-toggle">
          <button class="setting-name" type="button" data-action="toggle-provider" aria-expanded="${open}">
            <strong>${escapeHtml(provider.name)}</strong>
            <em>${escapeHtml(provider.capability)} · ${escapeHtml(provider.baseUrl)}</em>
          </button>
          <label class="enable-check" title="是否启用展示">
            <input name="${provider.id}-enabled" type="checkbox" data-field="enabled" ${cfg.enabled ? "checked" : ""}>
            <span></span>
          </label>
          <button class="setting-expand" type="button" data-action="toggle-provider">${open ? "收起" : "展开"}</button>
        </div>
        <div class="setting-grid" ${open ? "" : "hidden"}>
          <label>
            API Key
            <input name="${provider.id}-apiKey" type="password" data-field="apiKey" value="" placeholder="${cfg.hasApiKey ? "已加密保存，输入新 Key 可替换" : "sk-..."}" autocomplete="off">
          </label>
          <label>
            额度上限
            <input name="${provider.id}-limit" type="number" data-field="limit" value="${Number(cfg.limit || 0)}" min="0">
          </label>
          <label>
            剩余额度
            <input name="${provider.id}-remaining" type="number" data-field="remaining" value="${Number(cfg.remaining || 0)}" min="0">
          </label>
          <label>
            Base URL
            <input name="${provider.id}-baseUrl" type="url" data-field="baseUrl" value="${escapeHtml(cfg.baseUrl || "")}" autocomplete="off">
          </label>
        </div>
      </section>
    `;
  }).join("");
}

function renderAutoRefreshSettings() {
  const cfg = appState.autoRefresh || { enabled: false, intervalMinutes: 30 };
  autoRefreshSettings.innerHTML = `
    <div class="auto-refresh-head">
      <div>
        <strong>定时刷新</strong>
        <span>${cfg.enabled ? `每 ${cfg.intervalMinutes} 分钟刷新` : "关闭"}</span>
      </div>
      <label class="enable-check" title="是否启用定时刷新">
        <input id="autoRefreshEnabled" type="checkbox" ${cfg.enabled ? "checked" : ""}>
        <span></span>
      </label>
    </div>
    <div class="refresh-intervals">
      ${[5, 30, 60].map((minutes) => `
        <button class="interval-button ${Number(cfg.intervalMinutes) === minutes ? "active" : ""}" type="button" data-interval="${minutes}">
          ${minutes === 60 ? "1 小时" : `${minutes} 分钟`}
        </button>
      `).join("")}
    </div>
  `;
}

function renderAppearanceSettings() {
  const active = appState.appearance?.deerColor || "sky";
  appearanceSettings.innerHTML = `
    <div class="appearance-head">
      <strong>小鹿颜色</strong>
      <span>${escapeHtml(deerColors.find((item) => item.id === active)?.name || "天空蓝")}</span>
    </div>
    <div class="color-options">
      ${deerColors.map((item) => `
        <button class="color-swatch ${item.id === active ? "active" : ""}" type="button" data-deer-color="${item.id}" title="${escapeHtml(item.name)}">
          <span class="swatch-dot color-${item.id}"></span>
        </button>
      `).join("")}
    </div>
  `;
}

function applyDeerColor() {
  body.dataset.deerColor = appState.appearance?.deerColor || "sky";
}

function applyTheme() {
  const theme = appState.appearance?.theme === "dark" ? "dark" : "light";
  body.dataset.theme = theme;
  const themeButton = document.getElementById("themeToggleButton");
  if (themeButton) {
    themeButton.title = theme === "dark" ? "切换为白色主题" : "切换为黑色主题";
    themeButton.setAttribute("aria-label", themeButton.title);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

async function setMode(mode) {
  await window.quotaApp.setMode(mode);
  applyMode(mode);
}

function applyMode(mode) {
  body.classList.remove("mode-panel", "mode-collapsed", "mode-deer");
  body.classList.add(`mode-${mode}`);
  if (mode !== "panel") settingsView.hidden = true;
}

async function refreshAll() {
  appState = await window.quotaApp.refreshAll();
  render();
}

function scheduleAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  const cfg = appState.autoRefresh || {};
  if (!cfg.enabled) return;
  const minutes = [5, 30, 60].includes(Number(cfg.intervalMinutes)) ? Number(cfg.intervalMinutes) : 30;
  autoRefreshTimer = setInterval(refreshAll, minutes * 60 * 1000);
}

function showCloseChoice() {
  closeChoiceView.hidden = false;
}

function hideCloseChoice() {
  closeChoiceView.hidden = true;
}

function wireResizeHandle() {
  let resizeState = null;

  resizeHandle.addEventListener("pointerdown", (event) => {
    resizeState = {
      startX: event.screenX,
      startY: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight
    };
    resizeHandle.setPointerCapture(event.pointerId);
  });

  resizeHandle.addEventListener("pointermove", async (event) => {
    if (!resizeState) return;
    const width = resizeState.width + event.screenX - resizeState.startX;
    const height = resizeState.height + event.screenY - resizeState.startY;
    await window.quotaApp.resizePanel(width, height);
  });

  resizeHandle.addEventListener("pointerup", (event) => {
    resizeState = null;
    resizeHandle.releasePointerCapture(event.pointerId);
  });
}

function wireDeerDrag() {
  let dragState = null;

  deerBody.addEventListener("pointerdown", (event) => {
    dragState = {
      lastX: event.screenX,
      lastY: event.screenY,
      moved: false
    };
    deerBody.setPointerCapture(event.pointerId);
  });

  deerBody.addEventListener("pointermove", async (event) => {
    if (!dragState) return;
    const dx = event.screenX - dragState.lastX;
    const dy = event.screenY - dragState.lastY;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    dragState.moved = true;
    dragState.lastX = event.screenX;
    dragState.lastY = event.screenY;
    await window.quotaApp.moveWindow(dx, dy);
  });

  deerBody.addEventListener("pointerup", (event) => {
    if (!dragState) return;
    const shouldOpen = !dragState.moved;
    dragState = null;
    deerBody.releasePointerCapture(event.pointerId);
    if (shouldOpen) setMode("panel");
  });
}

async function boot() {
  const result = await window.quotaApp.getState();
  appState = result.state;
  providers = result.providers;
  applyTheme();
  applyDeerColor();
  applyMode(appState.mode || "panel");
  render();
  scheduleAutoRefresh();
  wireResizeHandle();
  wireDeerDrag();
}

document.getElementById("collapseButton").addEventListener("click", () => setMode("collapsed"));
document.getElementById("panelCloseButton").addEventListener("click", () => window.quotaApp.requestClose());
document.getElementById("themeToggleButton").addEventListener("click", async () => {
  const nextTheme = body.dataset.theme === "dark" ? "light" : "dark";
  appState = await window.quotaApp.updateAppearance({ theme: nextTheme });
  applyTheme();
});
document.getElementById("barExpandButton").addEventListener("click", () => setMode("panel"));
document.getElementById("barCloseButton").addEventListener("click", () => window.quotaApp.minimizeToTray());
document.getElementById("deerButton").addEventListener("click", () => setMode("deer"));
document.getElementById("settingsButton").addEventListener("click", () => {
  settingsView.hidden = false;
});
document.getElementById("closeSettings").addEventListener("click", () => {
  settingsView.hidden = true;
});
document.getElementById("refreshButton").addEventListener("click", refreshAll);
appearanceSettings.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-deer-color]");
  if (!button) return;
  appState = await window.quotaApp.updateAppearance({ deerColor: button.dataset.deerColor });
  applyDeerColor();
  renderSettings();
});
autoRefreshSettings.addEventListener("click", async (event) => {
  const intervalButton = event.target.closest("[data-interval]");
  if (!intervalButton) return;
  const current = appState.autoRefresh || { enabled: false, intervalMinutes: 30 };
  appState = await window.quotaApp.updateAutoRefresh({
    enabled: current.enabled,
    intervalMinutes: Number(intervalButton.dataset.interval)
  });
  renderSettings();
  scheduleAutoRefresh();
});
autoRefreshSettings.addEventListener("change", async (event) => {
  if (!event.target.matches("#autoRefreshEnabled")) return;
  const current = appState.autoRefresh || { enabled: false, intervalMinutes: 30 };
  appState = await window.quotaApp.updateAutoRefresh({
    enabled: event.target.checked,
    intervalMinutes: current.intervalMinutes || 30
  });
  renderSettings();
  scheduleAutoRefresh();
});
deerBody.addEventListener("mouseenter", () => {
  if (!deerBubble.hidden) return;
  deerBubble.hidden = false;
  deerBubble.innerHTML = `<strong>要查看额度吗？</strong><span>点击小鹿展开悬浮窗。</span>`;
});
deerBody.addEventListener("mouseleave", () => {
  if (enabledItems().some((item) => item.pct <= 20)) return;
  deerBubble.hidden = true;
});

settingsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='toggle-provider']");
  if (!button) return;
  const row = button.closest("[data-provider]");
  const id = row.dataset.provider;
  if (expandedSettings.has(id)) expandedSettings.delete(id);
  else expandedSettings.add(id);
  renderSettings();
});

settingsList.addEventListener("input", async (event) => {
  if (event.target.matches("input[type='checkbox']")) return;
  const row = event.target.closest("[data-provider]");
  const field = event.target.dataset.field;
  if (!row || !field) return;
  const id = row.dataset.provider;
  const value = event.target.value;
  const patch = { [field]: ["limit", "remaining"].includes(field) ? Number(value) : value };
  appState.providers[id] = { ...appState.providers[id], ...patch };
  appState = await window.quotaApp.updateProvider(id, patch);
});

settingsList.addEventListener("change", async (event) => {
  const row = event.target.closest("[data-provider]");
  if (!row) return;
  if (event.target.matches("input[type='checkbox']")) {
    appState = await window.quotaApp.updateProvider(row.dataset.provider, { enabled: event.target.checked });
  }
  render();
});

window.quotaApp.onModeChanged(applyMode);
window.quotaApp.onCloseChoiceRequested(showCloseChoice);
document.getElementById("choiceCancelButton").addEventListener("click", hideCloseChoice);
document.getElementById("choiceTrayButton").addEventListener("click", async () => {
  hideCloseChoice();
  await window.quotaApp.minimizeToTray();
});
document.getElementById("choiceQuitButton").addEventListener("click", async () => {
  hideCloseChoice();
  await window.quotaApp.quitNow();
});
document.addEventListener("dragstart", (event) => event.preventDefault());
boot();
