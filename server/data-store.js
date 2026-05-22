const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let dataPath;

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
  const filePath = getDataPath();
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  const filePath = getDataPath();
  fs.writeFileSync(filePath, JSON.stringify(notes, null, 2), 'utf-8');
}

module.exports = { loadNotes, saveNotes };
