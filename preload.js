const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  togglePin: () => ipcRenderer.send('window:togglePin'),
  onPinChanged: (callback) => {
    ipcRenderer.on('pin:changed', (_event, isPinned) => callback(isPinned));
  },

  // 贴边状态
  onSnapChanged: (callback) => {
    ipcRenderer.on('snap:changed', (_event, state) => callback(state));
  },

  // 自由 resize
  startResize: () => ipcRenderer.send('resize:start'),
  endResize: () => ipcRenderer.send('resize:end'),

  // 开机启动
  getAutoLaunch: () => ipcRenderer.invoke('autoLaunch:get'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('autoLaunch:set', enabled),

  // 数据操作
  getNotes: () => ipcRenderer.invoke('notes:getAll'),
  addNote: (note) => ipcRenderer.invoke('notes:add', note),
  updateNote: (id, changes) => ipcRenderer.invoke('notes:update', id, changes),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),

  // 提醒
  setReminder: (id, remindAt) => ipcRenderer.invoke('notes:setReminder', id, remindAt),
  onReminderTriggered: (callback) => {
    ipcRenderer.on('reminder:triggered', (_event, noteId) => callback(noteId));
  },

  // 同步
  startPairing: () => ipcRenderer.invoke('sync:startPairing'),
  joinWithCode: (code) => ipcRenderer.invoke('sync:joinWithCode', code),
  cancelPairing: () => ipcRenderer.invoke('sync:cancelPairing'),
  disconnect: () => ipcRenderer.invoke('sync:disconnect'),
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  onSyncStatusChanged: (callback) => {
    ipcRenderer.on('sync:statusChanged', (_event, status) => callback(status));
  },
  onSyncDataChanged: (callback) => {
    ipcRenderer.on('sync:dataChanged', () => callback());
  }
});
