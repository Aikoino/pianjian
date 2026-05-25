const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  togglePin: () => ipcRenderer.send('window:togglePin'),
  onPinChanged: (callback) => {
    const handler = (_event, isPinned) => callback(isPinned);
    ipcRenderer.on('pin:changed', handler);
    return () => ipcRenderer.removeListener('pin:changed', handler);
  },

  // 贴边状态
  onSnapChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('snap:changed', handler);
    return () => ipcRenderer.removeListener('snap:changed', handler);
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
    const handler = (_event, noteId) => callback(noteId);
    ipcRenderer.on('reminder:triggered', handler);
    return () => ipcRenderer.removeListener('reminder:triggered', handler);
  },

  // 同步
  startPairing: () => ipcRenderer.invoke('sync:startPairing'),
  joinWithCode: (code) => ipcRenderer.invoke('sync:joinWithCode', code),
  connectWithIP: (ip, port, code) => ipcRenderer.invoke('sync:connectWithIP', ip, port, code),
  cancelPairing: () => ipcRenderer.invoke('sync:cancelPairing'),
  disconnect: () => ipcRenderer.invoke('sync:disconnect'),
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  onSyncStatusChanged: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('sync:statusChanged', handler);
    return () => ipcRenderer.removeListener('sync:statusChanged', handler);
  },
  onSyncDataChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('sync:dataChanged', handler);
    return () => ipcRenderer.removeListener('sync:dataChanged', handler);
  }
});
