const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const { loadNotes, saveNotes } = require('./server/data-store');
const { getCloseAction, setCloseAction } = require('./server/config-store');

let mainWindow = null;
let isPinned = false;
let tray = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 340,
    height: 420,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 200,
    minHeight: 300,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: `${__dirname}/preload.js`
    }
  });

  mainWindow.loadFile('renderer/index.html');
  setupSnap();
  setupResizeConstraints();

  mainWindow.on('blur', () => {
    if (snapState && snapState.isShowing) hideWindow();
  });

  mainWindow.on('closed', () => {
    stopHoverPoll();
    stopResizePoll();
    mainWindow = null;
  });
}

function createTrayIcon() {
  // 生成 32x32 红色圆角方块托盘图标
  const size = 32;
  const radius = 6;
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let inRect = true;
      if (x < radius && y < radius && (radius - x) ** 2 + (radius - y) ** 2 > radius ** 2) inRect = false;
      if (x >= size - radius && y < radius && (x - (size - radius)) ** 2 + (radius - y) ** 2 > radius ** 2) inRect = false;
      if (x < radius && y >= size - radius && (radius - x) ** 2 + (y - (size - radius)) ** 2 > radius ** 2) inRect = false;
      if (x >= size - radius && y >= size - radius && (x - (size - radius)) ** 2 + (y - (size - radius)) ** 2 > radius ** 2) inRect = false;

      if (inRect) {
        buffer[idx] = 0xB7;     // R
        buffer[idx + 1] = 0x1C; // G
        buffer[idx + 2] = 0x1C; // B
        buffer[idx + 3] = 0xFF; // A
      }
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function createTray() {
  // 使用应用图标缩放为 16x16 托盘图标
  let trayIcon;
  try {
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
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
    }
  });
}

// ---- 贴边隐藏 ----
const SNAP = 20;
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

function setupSnap() {
  mainWindow.on('move', () => {
    if (ignoreMove || !mainWindow) return;

    // 贴边状态下：检测用户主动拖拽取消
    if (snapState) {
      const bounds = mainWindow.getBounds();
      const refX = snapState.isShowing ? snapState.visibleX : snapState.hiddenX;
      const refY = snapState.isShowing ? snapState.visibleY : snapState.hiddenY;
      const dist = Math.abs(bounds.x - refX) + Math.abs(bounds.y - refY);
      if (dist > UNSNAP_DISTANCE) {
        unsnap();
      }
      return;
    }

    if (unsnapCooldown) return;

    // 拖拽停止 300ms 后才检测贴边
    clearTimeout(snapPending);
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const { x: wx, y: wy, width: ww, height: wh } = display.workArea;

    const distToLeft = bounds.x - wx;
    const distToRight = (wx + ww) - (bounds.x + bounds.width);

    let edge = null;
    if (Math.abs(distToLeft) <= SNAP) edge = 'left';
    else if (Math.abs(distToRight) <= SNAP) edge = 'right';
    if (!edge) return;

    snapPending = setTimeout(() => {
      const cur = mainWindow.getBounds();
      const visibleX = cur.x;
      const visibleY = cur.y;

      let hiddenX;
      if (edge === 'right') {
        hiddenX = wx + ww - HANDLE_VISIBLE;
      } else {
        hiddenX = wx - cur.width + HANDLE_VISIBLE;
      }

      snapState = { edge, hiddenX, hiddenY: visibleY, visibleX, visibleY, isShowing: false };
      setPosSafely(hiddenX, visibleY);
      mainWindow.webContents.send('snap:changed', { snapped: true, edge, showing: false });
      startHoverPoll();
    }, 300);
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
  if (action === 'tray') { mainWindow.hide(); return; }
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
});

ipcMain.handle('notes:update', (_event, id, changes) => {
  const notes = loadNotes();
  const idx = notes.findIndex(n => n.id === id);
  if (idx !== -1) {
    Object.assign(notes[idx], changes, { updatedAt: new Date().toISOString() });
    saveNotes(notes);
  }
});

ipcMain.handle('notes:delete', (_event, id) => {
  let notes = loadNotes();
  notes = notes.filter(n => n.id !== id);
  saveNotes(notes);
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  // 开机自启时，启动后自动隐藏到托盘
  if (app.getLoginItemSettings().openAtLogin) {
    mainWindow?.hide();
  } else {
    mainWindow?.show();
  }
});

app.on('window-all-closed', () => {
  // 不退出，保持在托盘
});

app.on('before-quit', () => {
  isQuitting = true;
});
