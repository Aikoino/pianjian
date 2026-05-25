const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let dataPath;
let cachedNotes = null;

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
  const filePath = getDataPath();
  fs.writeFileSync(filePath, JSON.stringify(notes, null, 2), 'utf-8');
}

module.exports = { loadNotes, saveNotes };
