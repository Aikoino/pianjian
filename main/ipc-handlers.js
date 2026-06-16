// 所有 IPC 处理器
const { ipcMain, dialog, shell } = require('electron');
const { exec } = require('child_process');
const https = require('https');
const path = require('path');
const { loadNotes, saveNotes } = require('../server/data-store');
const { getCloseAction, setCloseAction, setIsPinned, getIsPinned } = require('../server/config-store');
const syncManager = require('../server/sync-manager');
const snap = require('./snap');

const AUTORUN_NAME = 'Pianjian';

let mainWindow = null;
let isPinned = false;
let isQuitting = false;

function setQuitting(v) { isQuitting = v; }
function getQuitting() { return isQuitting; }

// ---- 开机启动 ----
function runPowerShell(script, callback) {
  const base64 = Buffer.from(script, 'utf16le').toString('base64');
  exec(`powershell -NoProfile -EncodedCommand ${base64}`, callback);
}

function getLaunchTarget(app) {
  if (app.isPackaged) return `"${process.execPath}"`;
  return `"${process.execPath}" "${path.join(__dirname, '..', 'main.js')}"`;
}

// ---- 更新检查 ----
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
          const hasUpdate = latestVersion && latestVersion !== currentVersion;
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

  // 开机自启
  ipcMain.handle('autoLaunch:get', () => {
    return new Promise((resolve) => {
      const ps = `if (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${AUTORUN_NAME}' -EA SilentlyContinue) { exit 0 } else { exit 1 }`;
      runPowerShell(ps, (err) => resolve(!err));
    });
  });

  ipcMain.handle('autoLaunch:set', (_event, enabled) => {
    return new Promise((resolve) => {
      if (enabled) {
        const target = getLaunchTarget(app);
        const ps = `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${AUTORUN_NAME}' -Value '${target}' -Type String -Force`;
        runPowerShell(ps, (err) => {
          if (err) { console.error('autoLaunch set error:', err); resolve(false); }
          else resolve(true);
        });
      } else {
        const ps = `Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${AUTORUN_NAME}' -EA SilentlyContinue -Force`;
        runPowerShell(ps, () => resolve(true));
      }
    });
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
      Object.assign(notes[idx], changes, { updatedAt });
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
    shell.openExternal(url);
  });
}

module.exports = { registerIpcHandlers, checkForUpdate, setQuitting, getQuitting };
