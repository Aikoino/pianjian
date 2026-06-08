const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// 图标路径：生产模式从 resources 目录读取，开发模式从 build 目录读取
const ICON_PATH = (() => {
  const prodPath = path.join(process.resourcesPath || '', 'icon.png');
  return fs.existsSync(prodPath) ? prodPath : path.join(__dirname, 'build', 'icon.png');
})();

// 测试多实例支持（通过环境变量指定不同数据目录）
// 该环境变量会覆盖 data-store/config-store/sync-store 中的 appData 路径
global.__PIANJIAN_DATA_OVERRIDE = process.env.PIANJIAN_DATA_DIR || null;
if (global.__PIANJIAN_DATA_OVERRIDE) {
  console.log('[sync] 数据目录覆盖:', global.__PIANJIAN_DATA_OVERRIDE);
} else {
  console.log('[sync] 使用默认 appData 目录:', require('electron').app.getPath('appData'));
}
const { exec } = require('child_process');
const { loadNotes, saveNotes, flushNotes } = require('./server/data-store');
const { getCloseAction, setCloseAction, getWindowBounds, setWindowBounds, getSnapState, setSnapState, clearSnapState, getIsPinned, setIsPinned } = require('./server/config-store');
const syncManager = require('./server/sync-manager');

let mainWindow = null;
let isPinned = false;
let tray = null;
let isQuitting = false;

// ---- 便签提醒 ----
let reminderInterval = null;

function startReminderCheck() {
  // 每分钟检查一次是否有到期的提醒
  reminderInterval = setInterval(checkReminders, 60000);
  checkReminders(); // 启动时立即检查一次
}

function stopReminderCheck() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}

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
        // 计算下次提醒时间（重复提醒）或清空（单次提醒）
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
  }

  if (triggered.length > 0) {
    triggered.forEach(note => {
      triggerReminder(note);
    });
  }
}

function triggerReminder(note) {
  // 1. 弹出窗口（如果贴边隐藏中或已隐藏）
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (snapState && !snapState.isShowing) {
        showWindow();
      } else if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  } catch (e) {
    console.error('提醒弹窗失败:', e);
  }

  // 2. 发送 IPC 到渲染进程
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reminder:triggered', note.id);
    }
  } catch (e) {
    console.error('提醒 IPC 发送失败:', e);
  }

  // 3. 显示 Windows 系统通知（Toast Notification）
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

function createWindow() {
  // 恢复上次的窗口位置和大小
  const savedBounds = getWindowBounds();
  mainWindow = new BrowserWindow({
    width: savedBounds?.width || 340,
    height: savedBounds?.height || 420,
    x: savedBounds?.x,
    y: savedBounds?.y,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    minWidth: 200,
    minHeight: 300,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: `${__dirname}/preload.js`
    }
  });

  mainWindow.loadFile('renderer/index.html');

  // 恢复置顶状态
  const savedPinned = getIsPinned();
  if (savedPinned) {
    isPinned = true;
    mainWindow.setAlwaysOnTop(true);
  }

  setupSnap();
  setupResizeConstraints();

  // 拖动和缩放时保存位置
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('resize', scheduleSaveBounds);

  mainWindow.on('blur', () => {
    if (snapState && snapState.isShowing) hideWindow();
    // 贴边隐藏时：轮询暂停由 app 级别焦点检测控制
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      scheduleSaveBounds();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    stopHoverPoll();
    stopResizePoll();
    mainWindow = null;
  });
}

function createTray() {
  // 使用应用图标缩放为 16x16 托盘图标
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);
  tray.setToolTip('片笺');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
          // 贴边状态下显示到可见位置
          if (snapState && !snapState.isShowing) {
            showWindow();
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
      if (snapState && !snapState.isShowing) {
        showWindow();
      }
    }
  });
}

// ---- 贴边隐藏 ----
const SNAP = 50;
const HANDLE_VISIBLE = 26;
const HOVER_DELAY = 500;
const LEAVE_DELAY = 800;
const UNSNAP_DISTANCE = 40;

let snapState = null;        // { edge, hiddenX, hiddenY, visibleX, visibleY, isShowing }
let ignoreMove = false;
let snapPending = null;
let unsnapCooldown = false;
let hoverPoll = null;
let hoverStart = 0;
let leaveStart = 0;
let appFocused = true;       // 应用级焦点追踪

// ---- 自由 resize ----
let isResizing = false;
let resizePoll = null;
let resizeStartBounds = null;
let resizeStartCursor = null;

function setPosSafely(x, y) {
  ignoreMove = true;
  mainWindow.setPosition(x, y);
  setTimeout(() => { ignoreMove = false; }, 150);
}

// ---- 窗口位置持久化 ----
let saveBoundsTimer = null;
function scheduleSaveBounds() {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // 贴边状态下不保存隐藏位置，否则下次启动窗口会出现在屏幕外
    if (snapState) return;
    const bounds = mainWindow.getBounds();
    setWindowBounds(bounds);
  }, 300);
}

let lastMoveTime = 0;
let moveCountAfterEdge = 0;

function setupSnap() {
  mainWindow.on('move', () => {
    if (ignoreMove || !mainWindow) return;

    // 贴边状态下：检测用户主动拖拽取消
    if (snapState) {
      const bounds = mainWindow.getBounds();
      const refX = snapState.isShowing ? snapState.visibleX : snapState.hiddenX;
      const refY = snapState.isShowing ? snapState.visibleY : snapState.hiddenY;
      const dist = Math.abs(bounds.x - refX) + Math.abs(bounds.y - refY);
      console.log(`[snap] 拖拽取消检测: dist=${dist} threshold=${UNSNAP_DISTANCE}`);
      if (dist > UNSNAP_DISTANCE) {
        unsnap();
      }
      return;
    }

    if (unsnapCooldown) {
      console.log('[snap] 冷却中，跳过');
      return;
    }

    clearTimeout(snapPending);
    snapPending = null;

    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const { x: wx, width: ww } = display.workArea;
    const distToLeft = bounds.x - wx;
    const distToRight = (wx + ww) - (bounds.x + bounds.width);

    console.log(`[snap] 检测边缘: distToLeft=${distToLeft} distToRight=${distToRight} SNAP=${SNAP}`);

    let edge = null;
    // 窗口在边缘 20px 范围内，或超出屏幕边缘，都视为在边缘
    if (distToLeft <= SNAP || distToLeft < 0) edge = 'left';
    else if (distToRight <= SNAP || distToRight < 0) edge = 'right';

    if (edge) {
      console.log(`[snap] 检测到边缘: edge=${edge} moveCount=${moveCountAfterEdge}`);
      const now = Date.now();
      if (now - lastMoveTime > 100) {
        // 超过 100ms 没有 move 事件 → 认为新一轮拖拽开始
        moveCountAfterEdge = 0;
      }
      moveCountAfterEdge++;
      lastMoveTime = now;

      if (moveCountAfterEdge === 1) {
        // 第一次检测到在边缘：启动 500ms 定时器
        const detectedEdge = edge;
        snapPending = setTimeout(() => {
          if (snapState || unsnapCooldown) return;
          const cur = mainWindow.getBounds();
          const curDisplay = screen.getDisplayMatching(cur);
          const { x: cwx, width: cww } = curDisplay.workArea;
          const cDistLeft = cur.x - cwx;
          const cDistRight = (cwx + cww) - (cur.x + cur.width);
          let snapEdge = null;
          if (Math.abs(cDistLeft) <= SNAP) snapEdge = 'left';
          else if (Math.abs(cDistRight) <= SNAP) snapEdge = 'right';
          if (!snapEdge) return;

          const visibleX = cur.x;
          const visibleY = cur.y;
          let hiddenX = snapEdge === 'right'
            ? cwx + cww - HANDLE_VISIBLE
            : cwx - cur.width + HANDLE_VISIBLE;

          snapState = { edge: snapEdge, hiddenX, hiddenY: visibleY, visibleX, visibleY, isShowing: false };
          setSnapState({ edge: snapEdge, hiddenX, hiddenY: visibleY, visibleX, visibleY });
          setPosSafely(hiddenX, visibleY);
          mainWindow.webContents.send('snap:changed', { snapped: true, edge: snapEdge, showing: false });
          startHoverPoll();
        }, 500);
      }
      // moveCountAfterEdge > 1 → 用户还在拖拽，不重置定时器（保持 500ms 倒计时）
    }
    // 不在边缘：moveCountAfterEdge 在下次进入边缘时重置
  });
}

// ---- 窗口 resize 约束 ----
function setupResizeConstraints() {
  mainWindow.on('will-resize', (_event, newBounds) => {
    if (isResizing) return;
    const display = screen.getDisplayMatching(newBounds);
    const { width: sw, height: sh } = display.workArea;
    const maxW = Math.round(sw * 0.8);
    const maxH = Math.round(sh * 0.8);

    if (newBounds.width > maxW || newBounds.height > maxH) {
      _event.preventDefault();
      mainWindow.setBounds({
        x: newBounds.x,
        y: newBounds.y,
        width: Math.min(newBounds.width, maxW),
        height: Math.min(newBounds.height, maxH)
      });
    }
  });
}

function startResizePoll() {
  stopResizePoll();
  isResizing = true;
  resizeStartBounds = mainWindow.getBounds();
  resizeStartCursor = screen.getCursorScreenPoint();

  resizePoll = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) { stopResizePoll(); return; }
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - resizeStartCursor.x;
    const dy = cursor.y - resizeStartCursor.y;

    let newW = resizeStartBounds.width + dx;
    let newH = resizeStartBounds.height + dy;

    const display = screen.getDisplayMatching(resizeStartBounds);
    const maxW = Math.round(display.workArea.width * 0.8);
    const maxH = Math.round(display.workArea.height * 0.8);
    newW = Math.max(200, Math.min(newW, maxW));
    newH = Math.max(300, Math.min(newH, maxH));

    mainWindow.setSize(Math.round(newW), Math.round(newH));
  }, 16);
}

function stopResizePoll() {
  if (resizePoll) { clearInterval(resizePoll); resizePoll = null; }
  isResizing = false;
}

// ---- 鼠标轮询（拖拽区无法触发 DOM 事件） ----
function startHoverPoll() {
  stopHoverPoll();
  hoverStart = 0;
  leaveStart = 0;
  hoverPoll = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !snapState) { stopHoverPoll(); return; }

    // 应用不在前台时跳过光标检测，节省 CPU
    if (!appFocused) return;

    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();

    if (snapState.isShowing) {
      // 窗口完全可见 → 检测鼠标离开
      const outside = cursor.x < bounds.x || cursor.x > bounds.x + bounds.width
                   || cursor.y < bounds.y || cursor.y > bounds.y + bounds.height;
      if (outside) {
        if (!leaveStart) leaveStart = Date.now();
        else if (Date.now() - leaveStart >= LEAVE_DELAY) {
          hideWindow();
          leaveStart = 0;
        }
      } else {
        leaveStart = 0;
      }
    } else {
      // 窗口隐藏 → 检测鼠标悬停把手
      let inZone = false;
      if (snapState.edge === 'right') {
        inZone = cursor.x >= bounds.x && cursor.x <= bounds.x + HANDLE_VISIBLE
              && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height;
      } else {
        inZone = cursor.x >= bounds.x + bounds.width - HANDLE_VISIBLE
              && cursor.x <= bounds.x + bounds.width
              && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height;
      }

      if (inZone) {
        if (!hoverStart) hoverStart = Date.now();
        else if (Date.now() - hoverStart >= HOVER_DELAY) {
          showWindow();
        }
      } else {
        hoverStart = 0;
      }
    }
  }, 150);
}

function stopHoverPoll() {
  if (hoverPoll) { clearInterval(hoverPoll); hoverPoll = null; }
  hoverStart = 0;
  leaveStart = 0;
}

function unsnap() {
  if (!snapState || !mainWindow) return;
  stopHoverPoll();
  clearTimeout(snapPending);
  snapState = null;
  clearSnapState();
  unsnapCooldown = true;
  setTimeout(() => { unsnapCooldown = false; }, 800);
  mainWindow.webContents.send('snap:changed', { snapped: false, edge: null });
}

function showWindow() {
  if (!snapState || !mainWindow) return;
  snapState.isShowing = true;
  setPosSafely(snapState.visibleX, snapState.visibleY);
  mainWindow.webContents.send('snap:changed', { snapped: true, edge: snapState.edge, showing: true });
}

function hideWindow() {
  if (!snapState || !mainWindow) return;
  snapState.isShowing = false;
  setPosSafely(snapState.hiddenX, snapState.hiddenY);
  mainWindow.webContents.send('snap:changed', { snapped: true, edge: snapState.edge, showing: false });
}

ipcMain.on('resize:start', () => {
  if (!snapState) startResizePoll();
});

ipcMain.on('resize:end', () => {
  stopResizePoll();
});

ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:close', async () => {
  if (!mainWindow) return;
  const action = getCloseAction();
  if (action === 'tray') { scheduleSaveBounds(); mainWindow.hide(); return; }
  if (action === 'quit') { isQuitting = true; app.quit(); return; }

  // 首次关闭：弹出选择对话框
  // 注意：Electron 22 中 showMessageBoxSync 返回整数，需要用异步版获取 checkboxChecked
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
  if (result.checkboxChecked) {
    setCloseAction(choice);
  }

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

// ---- 开机启动 ----
const AUTORUN_NAME = 'Pianjian';

function runPowerShell(script, callback) {
  const base64 = Buffer.from(script, 'utf16le').toString('base64');
  exec(`powershell -NoProfile -EncodedCommand ${base64}`, callback);
}

function getLaunchTarget() {
  if (app.isPackaged) {
    return `"${process.execPath}"`;
  }
  return `"${process.execPath}" "${path.join(__dirname, 'main.js')}"`;
}

ipcMain.handle('autoLaunch:get', () => {
  return new Promise((resolve) => {
    const ps = `if (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${AUTORUN_NAME}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`;
    runPowerShell(ps, (err) => {
      resolve(!err);
    });
  });
});

ipcMain.handle('autoLaunch:set', (_event, enabled) => {
  return new Promise((resolve) => {
    if (enabled) {
      const target = getLaunchTarget();
      const ps = `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${AUTORUN_NAME}' -Value '${target}' -Type String -Force`;
      runPowerShell(ps, (err) => {
        if (err) { console.error('autoLaunch set error:', err); resolve(false); }
        else resolve(true);
      });
    } else {
      const ps = `Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${AUTORUN_NAME}' -ErrorAction SilentlyContinue -Force`;
      runPowerShell(ps, (err) => {
        resolve(true);
      });
    }
  });
});

// ---- 数据操作 ----
ipcMain.handle('notes:getAll', () => {
  return loadNotes();
});

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

// ---- 同步 ----
ipcMain.handle('sync:startPairing', () => {
  return syncManager.startPairing();
});

ipcMain.handle('sync:joinWithCode', (_event, code) => {
  syncManager.joinWithCode(code);
});

ipcMain.handle('sync:connectWithIP', (_event, ip, port, code) => {
  syncManager.connectByIP(ip, port, code);
});

ipcMain.handle('sync:cancelPairing', () => {
  syncManager.cancelPairing();
});

ipcMain.handle('sync:disconnect', () => {
  syncManager.disconnect();
});

ipcMain.handle('sync:getStatus', () => {
  return syncManager.getStatus();
});

// ---- 应用更新检查 ----
const https = require('https');

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
          const currentVersion = app.getVersion();
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

ipcMain.handle('update:check', () => checkForUpdate());

ipcMain.on('shell:openExternal', (_event, url) => {
  require('electron').shell.openExternal(url);
});

app.whenReady().then(() => {
  // 添加 Windows 防火墙规则（允许同步端口 48484 和 48485）
  try {
    exec('powershell -Command "New-NetFirewallRule -DisplayName \'片笺 同步\' -Direction Inbound -Protocol TCP -LocalPort 48484,48485 -Action Allow -Profile Any 2>$null; exit 0"', (err) => {
      if (err) console.log('[firewall] 防火墙规则添加失败（可忽略）:', err.message);
    });
  } catch (e) {}
  // 也允许 UDP 发现端口 48483
  try {
    exec('powershell -Command "New-NetFirewallRule -DisplayName \'片笺 发现\' -Direction Inbound -Protocol UDP -LocalPort 48483 -Action Allow -Profile Any 2>$null; exit 0"', (err) => {
      if (err) console.log('[firewall] UDP 防火墙规则添加失败（可忽略）:', err.message);
    });
  } catch (e) {}

  createWindow();
  createTray();

  // 应用级焦点追踪：非前台时跳过 hover 轮询的光标检测
  app.on('browser-window-focus', () => {
    appFocused = true;
    // 焦点恢复时重启轮询（如果处于贴边隐藏状态）
    if (snapState && !snapState.isShowing && hoverPoll) {
      startHoverPoll();
    }
  });
  app.on('browser-window-blur', () => {
    appFocused = false;
  });

  // 恢复贴边状态（校验坐标在当前屏幕内，否则忽略）
  const savedSnap = getSnapState();
  if (savedSnap) {
    const display = screen.getDisplayMatching({ x: savedSnap.visibleX, y: savedSnap.visibleY, width: 100, height: 100 });
    const { x: wx, y: wy, width: ww, height: wh } = display.workArea;
    const validX = savedSnap.visibleX >= wx && savedSnap.visibleX < wx + ww;
    const validY = savedSnap.visibleY >= wy && savedSnap.visibleY < wy + wh;
    if (validX && validY) {
      snapState = { ...savedSnap, isShowing: false };
      setPosSafely(snapState.hiddenX, snapState.hiddenY);
      startHoverPoll();
      mainWindow.webContents.send('snap:changed', { snapped: true, edge: snapState.edge, showing: false });
    } else {
      clearSnapState();
    }
  }

  // 启动提醒检查
  startReminderCheck();

  // 初始化同步管理器
  syncManager.init(mainWindow);
  syncManager.onStatusChange((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:statusChanged', status);
    }
  });

  // 启动时检查更新（延迟 5 秒，避免影响启动速度）
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      checkForUpdate().then((info) => {
        if (info.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:available', info);
        }
      });
    }
  }, 5000);

  // 开机自启时隐藏到托盘，否则显示窗口
  if (app.getLoginItemSettings().openAtLogin) {
    mainWindow?.hide();
  } else if (snapState) {
    // 非开机自启且恢复贴边：窗口显示在可见位置，而非隐藏位置
    snapState.isShowing = true;
    setPosSafely(snapState.visibleX, snapState.visibleY);
    mainWindow.webContents.send('snap:changed', { snapped: true, edge: snapState.edge, showing: true });
  } else {
    mainWindow?.show();
  }
});

app.on('window-all-closed', () => {
  // 不退出，保持在托盘
});

app.on('before-quit', () => {
  isQuitting = true;
  stopReminderCheck();
  flushNotes(); // 确保异步写入的数据落盘
  // 退出前保存最终窗口位置（贴边状态不保存隐藏坐标）
  if (mainWindow && !mainWindow.isDestroyed() && !snapState) {
    const bounds = mainWindow.getBounds();
    setWindowBounds(bounds);
  }
});
