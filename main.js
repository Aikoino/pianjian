const { app, BrowserWindow, Tray, Menu, nativeImage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// 图标路径
const ICON_PATH = (() => {
  const prodPath = path.join(process.resourcesPath || '', 'icon.png');
  return fs.existsSync(prodPath) ? prodPath : path.join(__dirname, 'build', 'icon.png');
})();

// 多实例数据目录覆盖
global.__PIANJIAN_DATA_OVERRIDE = process.env.PIANJIAN_DATA_DIR || null;
if (global.__PIANJIAN_DATA_OVERRIDE) {
  console.log('[sync] 数据目录覆盖:', global.__PIANJIAN_DATA_OVERRIDE);
} else {
  console.log('[sync] 使用默认 appData 目录:', app.getPath('appData'));
}

const { exec } = require('child_process');
const { flushNotes } = require('./server/data-store');
const { getWindowBounds, setWindowBounds, getIsPinned } = require('./server/config-store');
const syncManager = require('./server/sync-manager');
const snap = require('./main/snap');
const reminder = require('./main/reminder');
const ipc = require('./main/ipc-handlers');

let mainWindow = null;
let tray = null;

// ---- 创建窗口 ----
function createWindow() {
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
      preload: `${__dirname}/preload.js`
    }
  });

  mainWindow.loadFile('renderer/index.html');

  // 恢复置顶
  if (getIsPinned()) {
    mainWindow.setAlwaysOnTop(true);
  }

  // 初始化贴边和 resize
  snap.initSnap(mainWindow);

  // blur → 贴边展开时收回
  mainWindow.on('blur', () => {
    const s = snap.getState();
    if (s && s.isShowing) snap.hideWindow();
  });

  // 关闭 → 最小化到托盘
  mainWindow.on('close', (e) => {
    if (!ipc.getQuitting()) {
      e.preventDefault();
      snap.scheduleSaveBounds();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    snap.cleanup();
    mainWindow = null;
  });
}

// ---- 创建托盘 ----
function createTray() {
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);
  tray.setToolTip('片笺');

  function toggleVisibility() {
    if (!mainWindow) return;
    const s = snap.getState();
    if (!mainWindow.isVisible()) {
      // 窗口被隐藏（托盘/最小化），先 show 再处理贴边
      mainWindow.show();
      if (s && !s.isShowing) {
        snap.showWindow();
      }
      mainWindow.focus();
    } else if (s && s.isShowing) {
      // 贴边展开中 → 收回
      snap.hideWindow();
    } else {
      // 正常显示中 → 隐藏
      mainWindow.hide();
    }
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示/隐藏', click: toggleVisibility },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        ipc.setQuitting(true);
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', toggleVisibility);
}

// ---- 应用启动 ----
app.whenReady().then(() => {
  // 注册自定义协议，用于安全加载本地图片（替代 webSecurity: false）
  protocol.registerFileProtocol('local-img', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('local-img://', ''));
    // 只允许图片文件
    const ext = path.extname(filePath).toLowerCase();
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
    if (!allowed.includes(ext)) return callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND
    callback({ path: filePath });
  });

  // 防火墙规则
  try {
    const fwCmd = 'powershell -NoProfile -Command "if (!(Get-NetFirewallRule -DisplayName \'片笺 同步\' -EA SilentlyContinue)) { New-NetFirewallRule -DisplayName \'片笺 同步\' -Direction Inbound -Protocol TCP -LocalPort 48484,48485 -Action Allow -Profile Any | Out-Null; New-NetFirewallRule -DisplayName \'片笺 发现\' -Direction Inbound -Protocol UDP -LocalPort 48483 -Action Allow -Profile Any | Out-Null }"';
    exec(fwCmd, (err) => {
      if (err) console.log('[firewall] 防火墙规则检查失败（可忽略）:', err.message);
    });
  } catch (e) {}

  createWindow();
  createTray();

  // 注册 IPC
  ipc.registerIpcHandlers(mainWindow, app);

  // 焦点追踪
  app.on('browser-window-focus', () => snap.setAppFocused(true));
  app.on('browser-window-blur', () => snap.setAppFocused(false));

  // 恢复贴边状态
  const { getSnapState } = require('./server/config-store');
  const savedSnap = getSnapState();
  if (savedSnap) {
    snap.restoreSnap(mainWindow, savedSnap);
  }

  // 提醒系统
  reminder.startReminderCheck(mainWindow, snap.showWindow);

  // 同步管理器
  syncManager.init(mainWindow);
  syncManager.onStatusChange((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:statusChanged', status);
    }
  });

  // 启动 5 秒后检查更新
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      ipc.checkForUpdate().then((info) => {
        if (info.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:available', info);
        }
      });
    }
  }, 5000);

  // 开机自启 → 隐藏到托盘；否则显示窗口
  if (app.getLoginItemSettings().openAtLogin) {
    mainWindow?.hide();
  } else if (savedSnap) {
    snap.showRestored(mainWindow);
  } else {
    mainWindow?.show();
  }
});

app.on('window-all-closed', () => {
  // 保持在托盘
});

app.on('before-quit', () => {
  ipc.setQuitting(true);
  reminder.stopReminderCheck();
  flushNotes();
  if (mainWindow && !mainWindow.isDestroyed() && !snap.getState()) {
    const bounds = mainWindow.getBounds();
    setWindowBounds(bounds);
  }
});
