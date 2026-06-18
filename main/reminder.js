// 便签提醒系统
const { Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadNotes, saveNotes } = require('../server/data-store');
const syncManager = require('../server/sync-manager');

const ICON_PATH = (() => {
  const prodPath = path.join(process.resourcesPath || '', 'icon.png');
  return fs.existsSync(prodPath) ? prodPath : path.join(__dirname, '..', 'build', 'icon.png');
})();

let reminderInterval = null;
let mainWindow = null;
let showWindowFn = null; // 贴边状态下的 showWindow

function getNextRemindTime(note) {
  const repeat = note.reminderRepeat || 'none';
  if (repeat === 'none') return undefined;

  const base = new Date(note.remindAt);
  let next;

  switch (repeat) {
    case 'daily':
      next = new Date(base.getTime() + 24 * 60 * 60 * 1000);
      break;
    case 'weekly': {
      const days = note.reminderRepeatDays || [];
      if (days.length === 0) return undefined;
      next = new Date(base);
      for (let i = 1; i <= 7; i++) {
        next.setDate(next.getDate() + 1);
        if (days.includes(next.getDay())) break;
      }
      break;
    }
    case 'monthly': {
      next = new Date(base);
      const targetDay = note.reminderRepeatDay || base.getDate();
      next.setMonth(next.getMonth() + 1);
      next.setDate(Math.min(targetDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      break;
    }
    case 'yearly': {
      next = new Date(base);
      next.setFullYear(next.getFullYear() + 1);
      break;
    }
    case 'custom': {
      const days = note.reminderRepeatInterval || 1;
      next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
      break;
    }
    default:
      return undefined;
  }
  return next.toISOString();
}

function checkReminders() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const notes = loadNotes();
  const now = new Date();
  const triggered = [];
  let modified = false;

  notes.forEach(note => {
    if (!note.remindAt) return;
    if (note.type !== 'daily' && note.type !== 'weekly' && note.type !== 'timeline') return;
    try {
      const remindTime = new Date(note.remindAt);
      if (remindTime <= now) {
        triggered.push(note);
        note.remindAt = getNextRemindTime(note);
        note.updatedAt = new Date().toISOString();
        modified = true;
      }
    } catch (e) {
      console.error('提醒时间解析失败:', note.remindAt, e);
      note.remindAt = undefined;
      note.updatedAt = new Date().toISOString();
      modified = true;
    }
  });

  if (modified) {
    saveNotes(notes);
    // 同步广播：通知其他设备提醒时间已更新
    triggered.forEach(note => {
      syncManager.broadcast({
        type: 'note_update',
        id: note.id,
        changes: { remindAt: note.remindAt },
        updatedAt: note.updatedAt
      });
    });
  }

  triggered.forEach(note => triggerReminder(note));
}

function triggerReminder(note) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (showWindowFn) showWindowFn();
      mainWindow.show();
      mainWindow.focus();
    }
  } catch (e) {
    console.error('提醒弹窗失败:', e);
  }

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reminder:triggered', note.id);
    }
  } catch (e) {
    console.error('提醒 IPC 发送失败:', e);
  }

  try {
    const notification = new Notification({
      title: '片笺 - 便签提醒',
      body: (note.content || '(无内容)').substring(0, 200),
      icon: ICON_PATH
    });
    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notification.show();
  } catch (e) {
    console.error('系统通知失败:', e);
  }
}

function startReminderCheck(win, snapShowFn) {
  mainWindow = win;
  showWindowFn = snapShowFn;
  reminderInterval = setInterval(checkReminders, 60000);
  checkReminders();
}

function stopReminderCheck() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}

module.exports = { startReminderCheck, stopReminderCheck };
