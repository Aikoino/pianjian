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
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id)
});
