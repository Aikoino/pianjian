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

  function onChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function notify() {
    listeners.forEach(fn => fn(notes));
  }

  return { init, getNotes, addNote, updateNote, deleteNote, onChange };
})();
