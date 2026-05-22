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

  async function addNote(type) {
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
    await window.electronAPI.deleteNote(id);
    notes = notes.filter(n => n.id !== id);
    notify();
  }

  async function setReminder(id, remindAt) {
    await window.electronAPI.setReminder(id, remindAt);
    const note = notes.find(n => n.id === id);
    if (note) {
      note.remindAt = remindAt;
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

  return { init, getNotes, addNote, updateNote, deleteNote, setReminder, onReminderTriggeredFromMain, onChange };
})();
