const sidebar = (() => {
  const TYPES = ['daily', 'weekly', 'normal', 'timeline'];
  const LABELS = { daily: '今日', weekly: '周', normal: '便签', timeline: '时间轴' };

  let activeType = 'daily';
  let filterCallback = null;

  function init() {
    const el = document.getElementById('sidebar');
    TYPES.forEach(type => {
      const tab = document.createElement('button');
      tab.className = `sidebar__tab sidebar__tab--${type}`;
      tab.dataset.type = type;
      tab.innerHTML = `
        <span class="sidebar__dot sidebar__dot--${type}"></span>
        <span class="sidebar__count sidebar__count--${type}"></span>
        <span>${LABELS[type]}</span>
      `;
      tab.addEventListener('click', () => setActive(type));
      el.appendChild(tab);
    });

    setActive(activeType);
    updateCounts();

    state.onChange(() => updateCounts());
  }

  function setActive(type) {
    activeType = type;
    document.querySelectorAll('.sidebar__tab').forEach(t => {
      t.classList.toggle('sidebar__tab--active', t.dataset.type === type);
    });
    if (filterCallback) filterCallback(type);
  }

  function updateCounts() {
    const counts = {};
    const notes = state.getNotes();
    TYPES.forEach(t => { counts[t] = 0; });
    notes.forEach(n => {
      // 时间轴始终计入所有 timeline 条目
      if (n.type === 'timeline') counts.timeline++;
      // 晋升到 daily/weekly 的也同时计入对应分类
      const effective = getEffectiveType(n);
      if (effective !== 'timeline') counts[effective]++;
      else if (n.type !== 'timeline') counts[n.type]++;
    });
    TYPES.forEach(type => {
      const el = document.querySelector(`.sidebar__count--${type}`);
      if (el) el.textContent = counts[type] || '';
    });
  }

  function getFilter() {
    return activeType;
  }

  function onFilterChange(callback) {
    filterCallback = callback;
  }

  return { init, getFilter, setActive, onFilterChange };
})();
