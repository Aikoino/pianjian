// 所有 IPC 处理器
const { ipcMain, dialog, shell } = require('electron');
const https = require('https');
const path = require('path');
const { loadNotes, saveNotes } = require('../server/data-store');
const { getCloseAction, setCloseAction, setIsPinned, getIsPinned } = require('../server/config-store');
const syncManager = require('../server/sync-manager');
const snap = require('./snap');

let mainWindow = null;
let isPinned = false;
let isQuitting = false;

function setQuitting(v) { isQuitting = v; }
function getQuitting() { return isQuitting; }

// ---- 版本比较（语义化，替代字符串比较） ----
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ---- notes 字段白名单 ----
const NOTE_MUTABLE_FIELDS = ['content', 'type', 'customDate', 'collapsed', 'order'];

function sanitizeNoteChanges(changes) {
  const safe = {};
  for (const key of NOTE_MUTABLE_FIELDS) {
    if (key in changes) safe[key] = changes[key];
  }
  return safe;
}

function isValidNoteArray(arr) {
  return Array.isArray(arr) && arr.every(n => n && typeof n.id === 'string' && n.id.length > 0);
}
function checkForUpdate() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/Aikoino/pianjian/releases/latest',
      headers: { 'User-Agent': 'pianjian-app' },
      timeout: 10000,
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = release.tag_name?.replace('v', '') || '';
          const currentVersion = require('../package.json').version;
          const hasUpdate = latestVersion && compareVersions(latestVersion, currentVersion) > 0;
          const downloadUrl = release.html_url || '';
          const releaseNotes = release.body || '';
          resolve({ hasUpdate, latestVersion, currentVersion, downloadUrl, releaseNotes });
        } catch (e) {
          resolve({ hasUpdate: false });
        }
      });
    }).on('error', () => {
      resolve({ hasUpdate: false });
    });
  });
}

// ---- 注册所有 IPC ----
function registerIpcHandlers(win, app) {
  mainWindow = win;
  isPinned = getIsPinned();

  // 窗口控制
  ipcMain.on('resize:start', () => {
    if (!snap.getState()) snap.startResizePoll();
  });
  ipcMain.on('resize:end', () => snap.stopResizePoll());

  ipcMain.on('window:minimize', () => mainWindow?.minimize());

  ipcMain.on('window:close', async () => {
    if (!mainWindow) return;
    const action = getCloseAction();
    if (action === 'tray') { snap.scheduleSaveBounds(); mainWindow.hide(); return; }
    if (action === 'quit') { isQuitting = true; app.quit(); return; }

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '片笺',
      message: '关闭窗口',
      detail: '请选择关闭后的行为：',
      buttons: ['最小化到系统托盘', '退出程序'],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: '不再询问，记住我的选择',
      checkboxChecked: false
    });

    const choice = result.response === 0 ? 'tray' : 'quit';
    if (result.checkboxChecked) setCloseAction(choice);

    if (choice === 'tray') {
      mainWindow.hide();
    } else {
      isQuitting = true;
      app.quit();
    }
  });

  ipcMain.on('window:togglePin', () => {
    isPinned = !isPinned;
    mainWindow?.setAlwaysOnTop(isPinned);
    mainWindow?.webContents.send('pin:changed', isPinned);
    setIsPinned(isPinned);
  });

  // 开机自启（使用 Electron 原生 API，无需 PowerShell）
  ipcMain.handle('autoLaunch:get', () => {
    try {
      return app.getLoginItemSettings().openAtLogin || false;
    } catch (e) {
      console.error('[autoLaunch] 获取自启状态失败:', e);
      return false;
    }
  });

  ipcMain.handle('autoLaunch:set', (_event, enabled) => {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled });
      return true;
    } catch (e) {
      console.error('[autoLaunch] 设置自启失败:', e);
      return false;
    }
  });

  // 数据操作
  ipcMain.handle('notes:getAll', () => loadNotes());

  ipcMain.handle('notes:add', (_event, note) => {
    const notes = loadNotes();
    notes.push(note);
    saveNotes(notes);
    syncManager.broadcast({ type: 'note_add', note });
  });

  ipcMain.handle('notes:update', (_event, id, changes) => {
    const notes = loadNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx !== -1) {
      const updatedAt = new Date().toISOString();
      const safeChanges = sanitizeNoteChanges(changes);
      Object.assign(notes[idx], safeChanges, { updatedAt });
      saveNotes(notes);
      syncManager.broadcast({ type: 'note_update', id, changes, updatedAt });
    }
  });

  ipcMain.handle('notes:delete', (_event, id) => {
    let notes = loadNotes();
    notes = notes.filter(n => n.id !== id);
    saveNotes(notes);
    syncManager.broadcast({ type: 'note_delete', id });
  });

  ipcMain.handle('notes:saveAll', (_event, orderedNotes) => {
    if (!isValidNoteArray(orderedNotes)) {
      console.error('[notes:saveAll] 无效数据，已拒绝');
      return;
    }
    saveNotes(orderedNotes);
  });

  ipcMain.handle('notes:setReminder', (_event, id, remindAt) => {
    const notes = loadNotes();
    const note = notes.find(n => n.id === id);
    if (note) {
      note.remindAt = remindAt || undefined;
      const updatedAt = new Date().toISOString();
      note.updatedAt = updatedAt;
      saveNotes(notes);
      syncManager.broadcast({ type: 'note_update', id, changes: { remindAt: note.remindAt }, updatedAt });
      return true;
    }
    return false;
  });

  // 同步
  ipcMain.handle('sync:startPairing', () => syncManager.startPairing());
  ipcMain.handle('sync:joinWithCode', (_event, code) => syncManager.joinWithCode(code));
  ipcMain.handle('sync:connectWithIP', (_event, ip, port, code) => syncManager.connectByIP(ip, port, code));
  ipcMain.handle('sync:cancelPairing', () => syncManager.cancelPairing());
  ipcMain.handle('sync:disconnect', () => syncManager.disconnect());
  ipcMain.handle('sync:getStatus', () => syncManager.getStatus());

  // 更新检查
  ipcMain.handle('update:check', () => checkForUpdate());

  ipcMain.on('shell:openExternal', (_event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      } else {
        console.warn('[shell] 已拦截非 HTTP 协议 URL:', url);
      }
    } catch (e) {
      console.warn('[shell] 无效的 URL:', url);
    }
  });
}

module.exports = { registerIpcHandlers, checkForUpdate, setQuitting, getQuitting };
