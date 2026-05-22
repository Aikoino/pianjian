const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let configPath;

function getConfigPath() {
  if (!configPath) {
    const appData = app.getPath('appData');
    const dir = path.join(appData, 'pianjian');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    configPath = path.join(dir, 'config.json');
  }
  return configPath;
}

function loadConfig() {
  try {
    const filePath = getConfigPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
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

module.exports = {
  getCloseAction, setCloseAction,
  getWindowBounds, setWindowBounds,
  getSnapState, setSnapState, clearSnapState,
  getIsPinned, setIsPinned
};
