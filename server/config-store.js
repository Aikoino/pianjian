const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let configPath;
let cachedConfig = null;

function getConfigPath() {
  if (!configPath) {
    const base = global.__PIANJIAN_DATA_OVERRIDE || app.getPath('appData');
    const dir = path.join(base, 'pianjian');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    configPath = path.join(dir, 'config.json');
  }
  return configPath;
}

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const filePath = getConfigPath();
    if (!fs.existsSync(filePath)) {
      cachedConfig = {};
      return cachedConfig;
    }
    cachedConfig = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return cachedConfig;
  } catch {
    cachedConfig = {};
    return cachedConfig;
  }
}

function saveConfig(config) {
  cachedConfig = config;
  const filePath = getConfigPath();
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

function getCloseAction() {
  const config = loadConfig();
  return config.closeAction || null; // 'tray' | 'quit' | null
}

function setCloseAction(action) {
  const config = loadConfig();
  config.closeAction = action;
  saveConfig(config);
}

function getWindowBounds() {
  const config = loadConfig();
  return config.windowBounds || null; // { x, y, width, height }
}

function setWindowBounds(bounds) {
  const config = loadConfig();
  config.windowBounds = bounds;
  saveConfig(config);
}

function getSnapState() {
  const config = loadConfig();
  return config.snapState || null; // { edge, hiddenX, hiddenY, visibleX, visibleY }
}

function setSnapState(state) {
  const config = loadConfig();
  config.snapState = state;
  saveConfig(config);
}

function clearSnapState() {
  const config = loadConfig();
  delete config.snapState;
  saveConfig(config);
}

function getIsPinned() {
  const config = loadConfig();
  return config.isPinned || false;
}

function setIsPinned(pinned) {
  const config = loadConfig();
  config.isPinned = pinned;
  saveConfig(config);
}

function getTheme() {
  const config = loadConfig();
  return config.theme || 'light';
}

function setTheme(theme) {
  const config = loadConfig();
  config.theme = theme;
  saveConfig(config);
}

function getReminderPresets() {
  const config = loadConfig();
  return config.reminderPresets || [
    { label: '5 分钟', type: 'minutes', value: 5 },
    { label: '30 分钟', type: 'minutes', value: 30 },
    { label: '1 小时', type: 'hours', value: 1 },
    { label: '明天 9:00', type: 'tomorrow', hour: 9 },
    { label: '下周一 9:00', type: 'nextWeekday', weekday: 1, hour: 9 },
  ];
}

function setReminderPresets(presets) {
  const config = loadConfig();
  config.reminderPresets = presets;
  saveConfig(config);
}

module.exports = {
  getCloseAction, setCloseAction,
  getWindowBounds, setWindowBounds,
  getSnapState, setSnapState, clearSnapState,
  getIsPinned, setIsPinned,
  getTheme, setTheme,
  getReminderPresets, setReminderPresets
};
