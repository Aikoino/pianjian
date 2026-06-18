// 贴边隐藏/显示逻辑
const { screen } = require('electron');
const { getSnapState, setSnapState, clearSnapState } = require('../server/config-store');

const SNAP = 50;
const HANDLE_VISIBLE = 26;
const HOVER_DELAY = 500;
const LEAVE_DELAY = 800;
const UNSNAP_DISTANCE = 40;
const COOLDOWN_MS = 500;

const DEBUG = !require('electron').app.isPackaged;
function log(...args) { if (DEBUG) console.log('[snap]', ...args); }

let mainWindow = null;
let snapState = null;
let ignoreMove = false;
let ignoreMoveTimer = null;
let snapPending = null;
let cooldownTimer = null;
let unsnapCooldown = false;
let hoverPoll = null;
let hoverStart = 0;
let leaveStart = 0;
let appFocused = true;

// ---- Resize ----
let isResizing = false;
let resizePoll = null;
let resizeStartBounds = null;
let resizeStartCursor = null;

// ---- 位置持久化 ----
let saveBoundsTimer = null;

function setPosSafely(x, y) {
  ignoreMove = true;
  mainWindow.setPosition(x, y);
  if (ignoreMoveTimer) clearTimeout(ignoreMoveTimer);
  ignoreMoveTimer = setTimeout(() => { ignoreMove = false; }, 150);
}

function scheduleSaveBounds() {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (snapState) return;
    const bounds = mainWindow.getBounds();
    require('../server/config-store').setWindowBounds(bounds);
  }, 300);
}

// ---- 贴边检测 ----
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
      log(`拖拽取消检测: dist=${dist} threshold=${UNSNAP_DISTANCE}`);
      if (dist > UNSNAP_DISTANCE) {
        unsnap();
      }
      return;
    }

    if (unsnapCooldown) return;

    clearTimeout(snapPending);
    snapPending = null;

    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const { x: wx, width: ww } = display.workArea;
    const distToLeft = bounds.x - wx;
    const distToRight = (wx + ww) - (bounds.x + bounds.width);

    let edge = null;
    if (distToLeft <= SNAP || distToLeft < 0) edge = 'left';
    else if (distToRight <= SNAP || distToRight < 0) edge = 'right';

    if (edge) {
      log(`检测到边缘: edge=${edge}`);
      const now = Date.now();
      if (now - lastMoveTime > 100) {
        moveCountAfterEdge = 0;
      }
      moveCountAfterEdge++;
      lastMoveTime = now;

      if (moveCountAfterEdge === 1) {
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
    }
  });
}

// ---- Resize 约束 ----
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

// ---- Hover 轮询 ----
function startHoverPoll() {
  stopHoverPoll();
  hoverStart = 0;
  leaveStart = 0;
  hoverPoll = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !snapState) { stopHoverPoll(); return; }
    if (!appFocused) return;

    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();

    if (snapState.isShowing) {
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
          hoverStart = 0; // 避免重复调用
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

// ---- 公共操作 ----
function unsnap() {
  if (!snapState || !mainWindow) return;
  stopHoverPoll();
  clearTimeout(snapPending);
  snapState = null;
  clearSnapState();
  unsnapCooldown = true;
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    unsnapCooldown = false;
    cooldownTimer = null;
  }, COOLDOWN_MS);
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

function getState() {
  return snapState;
}

function setAppFocused(focused) {
  appFocused = focused;
  // 焦点恢复时重启轮询
  if (focused && snapState && !snapState.isShowing && hoverPoll) {
    startHoverPoll();
  }
}

function restoreSnap(win, savedSnap) {
  mainWindow = win;
  const display = screen.getDisplayMatching({ x: savedSnap.visibleX, y: savedSnap.visibleY, width: 100, height: 100 });
  const { x: wx, y: wy, width: ww, height: wh } = display.workArea;
  const validX = savedSnap.visibleX >= wx && savedSnap.visibleX < wx + ww;
  const validY = savedSnap.visibleY >= wy && savedSnap.visibleY < wy + wh;
  if (validX && validY) {
    snapState = { ...savedSnap, isShowing: false };
    setPosSafely(snapState.hiddenX, snapState.hiddenY);
    startHoverPoll();
    mainWindow.webContents.send('snap:changed', { snapped: true, edge: snapState.edge, showing: false });
    return true;
  } else {
    clearSnapState();
    return false;
  }
}

function showRestored(win) {
  mainWindow = win;
  if (!snapState) return;
  snapState.isShowing = true;
  setPosSafely(snapState.visibleX, snapState.visibleY);
  mainWindow.webContents.send('snap:changed', { snapped: true, edge: snapState.edge, showing: true });
}

function initSnap(win) {
  mainWindow = win;
  setupSnap();
  setupResizeConstraints();
  win.on('move', scheduleSaveBounds);
  win.on('resize', scheduleSaveBounds);
}

function cleanup() {
  stopHoverPoll();
  stopResizePoll();
  if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; }
  if (snapPending) { clearTimeout(snapPending); snapPending = null; }
  if (saveBoundsTimer) { clearTimeout(saveBoundsTimer); saveBoundsTimer = null; }
  if (ignoreMoveTimer) { clearTimeout(ignoreMoveTimer); ignoreMoveTimer = null; }
}

module.exports = {
  initSnap, cleanup, scheduleSaveBounds,
  showWindow, hideWindow, unsnap,
  getState, setAppFocused,
  restoreSnap, showRestored,
  startResizePoll, stopResizePoll
};
