const sidebar = (() => {
  const TYPES = ['all', 'daily', 'weekly', 'normal', 'timeline'];
  const LABELS = { all: '全部', daily: '今日', weekly: '周', normal: '便签', timeline: '时间轴' };

  let activeType = 'all';
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

    // 分隔线
    const sep = document.createElement('div');
    sep.className = 'sidebar__sep';
    el.appendChild(sep);

    // 回收站
    const trashTab = document.createElement('button');
    trashTab.className = 'sidebar__tab sidebar__tab--trash';
    trashTab.dataset.type = 'trash';
    trashTab.innerHTML = `
      <span class="sidebar__icon">&#x1F5D1;</span>
      <span class="sidebar__count sidebar__count--trash"></span>
      <span>回收站</span>
    `;
    trashTab.addEventListener('click', () => setActive('trash'));
    el.appendChild(trashTab);

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
    const counts = computeNoteCounts(state.getNotes());
    TYPES.concat(['trash']).forEach(type => {
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
