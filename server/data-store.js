const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let dataPath;
let cachedNotes = null;
let saveTimer = null;
let pendingData = null;

function getDataPath() {
  if (!dataPath) {
    const base = global.__PIANJIAN_DATA_OVERRIDE || app.getPath('appData');
    const dir = path.join(base, 'pianjian');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    dataPath = path.join(dir, 'data.json');
  }
  return dataPath;
}

function loadNotes() {
  if (cachedNotes) return cachedNotes;
  const filePath = getDataPath();
  try {
    if (!fs.existsSync(filePath)) {
      cachedNotes = [];
      return cachedNotes;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    cachedNotes = JSON.parse(raw);
    return cachedNotes;
  } catch {
    cachedNotes = [];
    return cachedNotes;
  }
}

function saveNotes(notes) {
  cachedNotes = notes;
  const json = JSON.stringify(notes, null, 2);
  pendingData = json;

  // 防抖：300ms 内多次调用只写最后一次
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushNotes();
  }, 300);
}

// 同步写入，用于退出前确保数据落盘
function flushNotes() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingData === null) return;
  const filePath = getDataPath();
  try {
    fs.writeFileSync(filePath, pendingData, 'utf-8');
  } catch (e) {
    console.error('[data-store] 写入失败:', e);
  }
  pendingData = null;
}

module.exports = { loadNotes, saveNotes, flushNotes };
