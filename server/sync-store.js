const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

let syncPath;
let cachedSync = null;

function getSyncPath() {
  if (!syncPath) {
    const base = global.__PIANJIAN_DATA_OVERRIDE || app.getPath('appData');
    const dir = path.join(base, 'pianjian');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    syncPath = path.join(dir, 'sync.json');
  }
  return syncPath;
}

function loadSync() {
  if (cachedSync) return cachedSync;
  try {
    const fp = getSyncPath();
    if (!fs.existsSync(fp)) {
      cachedSync = {};
      return cachedSync;
    }
    cachedSync = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return cachedSync;
  } catch {
    cachedSync = {};
    return cachedSync;
  }
}

function saveSync(data) {
  cachedSync = data;
  fs.writeFileSync(getSyncPath(), JSON.stringify(data, null, 2), 'utf-8');
}

function getDeviceId() {
  const sync = loadSync();
  if (!sync.deviceId) {
    sync.deviceId = crypto.randomUUID();
    saveSync(sync);
  }
  return sync.deviceId;
}

function getPairedDevice() {
  const sync = loadSync();
  return sync.pairedDevice || null;
}

function setPairedDevice(info) {
  const sync = loadSync();
  sync.pairedDevice = info;
  saveSync(sync);
}

function clearPairedDevice() {
  const sync = loadSync();
  delete sync.pairedDevice;
  saveSync(sync);
}

function getDeviceName() {
  const sync = loadSync();
  if (!sync.deviceName) {
    sync.deviceName = require('os').hostname() || '未知设备';
    saveSync(sync);
  }
  return sync.deviceName;
}

function setDeviceName(name) {
  const sync = loadSync();
  sync.deviceName = name;
  saveSync(sync);
}

module.exports = {
  getDeviceId, getPairedDevice, setPairedDevice, clearPairedDevice,
  getDeviceName, setDeviceName
};
