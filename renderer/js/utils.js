// UUID v4 生成
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : r & 0x3 | 0x8).toString(16);
  });
}

// 防抖
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// timeline 条目自动晋升
// 日期 = 今天 → daily；日期 = 本周 → weekly；否则保持 timeline
function getEffectiveType(note) {
  if (note.type !== 'timeline' || !note.customDate) return note.type;

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (note.customDate === todayStr) return 'daily';

  const custom = new Date(note.customDate + 'T00:00:00');
  const dow = today.getDay(); // 0=周日
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  if (custom >= monday && custom <= sunday) return 'weekly';
  return 'timeline';
}

// 统计各类便签数量（含回收站）
function computeNoteCounts(notes) {
  const counts = { daily: 0, weekly: 0, normal: 0, timeline: 0, trash: 0 };
  notes.forEach(n => {
    if (n.deletedAt) { counts.trash++; return; }
    if (n.type === 'timeline') counts.timeline++;
    const effective = getEffectiveType(n);
    if (effective !== 'timeline') counts[effective]++;
    else if (n.type !== 'timeline') counts[n.type]++;
  });
  return counts;
}
