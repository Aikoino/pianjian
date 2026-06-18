const state = (() => {
  let notes = [];
  const listeners = new Set();

  async function init() {
    notes = await window.electronAPI.getNotes();
    notify();
  }

  function getNotes() {
    return notes;
  }

  async function addNote(type, remindAt) {
    const note = {
      id: uuid(),
      type,
      content: '',
      completed: false,
      collapsed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (type === 'timeline') {
      note.customDate = new Date().toISOString().slice(0, 10);
    }
    if (remindAt) {
      note.remindAt = remindAt;
    }
    await window.electronAPI.addNote(note);
    notes.push(note);
    notify();
    return note;
  }

  async function updateNote(id, changes) {
    await window.electronAPI.updateNote(id, changes);
    const note = notes.find(n => n.id === id);
    if (note) {
      Object.assign(note, changes);
      note.updatedAt = new Date().toISOString();
    }
    notify();
  }

  async function deleteNote(id) {
    // 软删除：标记 deletedAt，不从数组移除
    const note = notes.find(n => n.id === id);
    if (note) {
      note.deletedAt = new Date().toISOString();
      note.updatedAt = new Date().toISOString();
      await window.electronAPI.updateNote(id, { deletedAt: note.deletedAt, updatedAt: note.updatedAt });
    }
    notify();
  }

  async function restoreNote(id) {
    const note = notes.find(n => n.id === id);
    if (note) {
      note.deletedAt = null;
      note.updatedAt = new Date().toISOString();
      await window.electronAPI.updateNote(id, { deletedAt: null, updatedAt: note.updatedAt });
    }
    notify();
  }

  async function permanentDeleteNote(id) {
    await window.electronAPI.deleteNote(id);
    notes = notes.filter(n => n.id !== id);
    notify();
  }

  function getDeletedNotes() {
    return notes.filter(n => n.deletedAt);
  }

  // 清除超过 30 天的已删除便签
  async function purgeOldNotes() {
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const toPurge = notes.filter(n => n.deletedAt && (now - new Date(n.deletedAt).getTime()) > THIRTY_DAYS);
    for (const note of toPurge) {
      await window.electronAPI.deleteNote(note.id);
    }
    if (toPurge.length > 0) {
      notes = notes.filter(n => !toPurge.find(p => p.id === n.id));
      notify();
    }
  }

  // 拖拽排序：将 noteId 移动到 targetId 之前/之后，或末尾
  async function reorderNotes(noteId, targetId, position) {
    const fromIdx = notes.findIndex(n => n.id === noteId);
    if (fromIdx === -1) return;
    const [moved] = notes.splice(fromIdx, 1);
    if (position === 'end' || targetId === null) {
      notes.push(moved);
    } else {
      let toIdx = notes.findIndex(n => n.id === targetId);
      if (toIdx === -1) toIdx = notes.length;
      if (position === 'after') toIdx++;
      notes.splice(toIdx, 0, moved);
    }
    // 持久化新顺序
    try {
      await window.electronAPI.saveAllNotes(notes);
    } catch (e) {
      console.error('[state] 保存排序失败:', e);
    }
    notify();
  }

  async function setReminder(id, remindAt) {
    await window.electronAPI.setReminder(id, remindAt);
    const note = notes.find(n => n.id === id);
    if (note) {
      note.remindAt = remindAt;
      if (!remindAt) {
        // 取消提醒时清除重复字段
        note.reminderRepeat = undefined;
        note.reminderRepeatDays = undefined;
        note.reminderRepeatInterval = undefined;
      }
      note.updatedAt = new Date().toISOString();
    }
    notify();
  }

  // 主进程提醒触发后的回调：更新本地状态并触发 UI 重渲染
  function onReminderTriggeredFromMain(noteId) {
    const note = notes.find(n => n.id === noteId);
    if (note) {
      note.remindAt = undefined;
      note.updatedAt = new Date().toISOString();
    }
    notify();
  }

  function onChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function notify() {
    listeners.forEach(fn => fn(notes));
  }

  return { init, getNotes, addNote, updateNote, deleteNote, restoreNote, permanentDeleteNote, getDeletedNotes, purgeOldNotes, reorderNotes, setReminder, onReminderTriggeredFromMain, onChange };
})();
