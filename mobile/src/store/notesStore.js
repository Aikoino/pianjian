import AsyncStorage from '@react-native-async-storage/async-storage';
import { scheduleReminder, cancelReminder } from '../utils/notifications';

const STORAGE_KEY = '@pianjian_notes';

let notes = [];
let listeners = new Set();
let saveTimer = null;

async function loadNotes() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    notes = raw ? JSON.parse(raw) : [];
  } catch {
    notes = [];
  }
  return notes;
}

function saveNotesImmediate() {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(notes)).catch(e =>
    console.warn('[notesStore] 保存失败:', e.message)
  );
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNotesImmediate, 300);
}

function getNotes() {
  return notes;
}

function addNote(type, customDate, remindAt) {
  const note = {
    id: uuid(),
    type,
    content: '',
    completed: false,
    collapsed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (type === 'timeline' && customDate) {
    note.customDate = customDate;
  } else if (type === 'timeline') {
    note.customDate = new Date().toISOString().slice(0, 10);
  }
  if (remindAt) {
    note.remindAt = remindAt;
  }
  notes.push(note);
  scheduleSave();
  notify();
  return note;
}

function updateNote(id, changes) {
  const note = notes.find(n => n.id === id);
  if (note) {
    Object.assign(note, changes);
    note.updatedAt = new Date().toISOString();
  }
  scheduleSave();
  notify();
}

function deleteNote(id) {
  notes = notes.filter(n => n.id !== id);
  scheduleSave();
  notify();
}

function insertNote(note) {
  if (notes.find(n => n.id === note.id)) return;
  notes.push(note);
  scheduleSave();
  notify();
}

function setReminder(id, remindAt) {
  const note = notes.find(n => n.id === id);
  if (note) {
    // 取消旧提醒，设置新提醒
    if (note.notificationId) cancelReminder(note.notificationId);
    note.remindAt = remindAt;
    note.updatedAt = new Date().toISOString();
    scheduleReminder(id, note.content, remindAt).then(nid => {
      if (nid) note.notificationId = nid;
    });
  }
  scheduleSave();
  notify();
}

// 供同步层使用：全量覆盖本地便签
function setNotes(newNotes) {
  notes = newNotes;
  scheduleSave();
  notify();
}

function onChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  listeners.forEach(fn => fn(notes));
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : r & 0x3 | 0x8).toString(16);
  });
}

export default {
  loadNotes,
  getNotes,
  addNote,
  insertNote,
  updateNote,
  deleteNote,
  setReminder,
  setNotes,
  onChange,
};
