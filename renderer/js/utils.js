// UUID v4 生成（使用密码学安全随机数）
function uuid() {
  return crypto.randomUUID();
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
  // 使用本地时区日期（避免 toISOString() 返回 UTC 导致 off-by-one）
  const todayStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
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
  const counts = { all: 0, daily: 0, weekly: 0, normal: 0, timeline: 0, trash: 0 };
  notes.forEach(n => {
    if (n.deletedAt) { counts.trash++; return; }
    counts.all++; // 全部 = 非删除便签总数
    const effective = getEffectiveType(n);
    if (counts[effective] !== undefined) counts[effective]++;
  });
  return counts;
}
