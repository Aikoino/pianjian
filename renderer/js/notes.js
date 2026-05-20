const notes = (() => {
  let lastKeys = new Set();
  let searchQuery = '';

  function getFiltered() {
    const allNotes = state.getNotes();
    const typeFilter = sidebar.getFilter();
    return allNotes.filter(n => {
      // 时间轴显示所有 timeline 条目（含已晋升的）
      if (typeFilter === 'timeline') {
        if (n.type !== 'timeline') return false;
      } else {
        if (getEffectiveType(n) !== typeFilter) return false;
      }
      if (searchQuery && !n.content.toLowerCase().includes(searchQuery)) return false;
      return true;
    });
  }

  // 渲染键：涵盖所有影响卡片呈现的字段
  function renderKey(n) {
    return `${n.id}:${n.completed ? 1 : 0}:${getEffectiveType(n)}`;
  }

  function init() {
    state.onChange(() => {
      const currentKeys = new Set(getFiltered().map(renderKey));
      if (!setsEqual(lastKeys, currentKeys)) render();
    });
    sidebar.onFilterChange(() => render());
    render();
  }

  function setSearch(query) {
    searchQuery = query.trim().toLowerCase();
    render();
  }

  function render() {
    const container = document.getElementById('notes-area');
    const filtered = getFiltered();

    lastKeys = new Set(filtered.map(renderKey));
    container.innerHTML = '';

    if (filtered.length === 0) {
      const msg = searchQuery
        ? '没有匹配的便签'
        : '暂无便签，点击 + 添加';
      container.innerHTML = `
        <div class="notes-empty">
          <span class="notes-empty__icon">&#x1F4DD;</span>
          <span>${msg}</span>
        </div>`;
      return;
    }

    filtered.forEach(note => {
      container.appendChild(createCard(note));
    });
  }

  function createCard(note) {
    const card = document.createElement('div');
    const effectiveType = getEffectiveType(note);
    const expired = isExpired(note);
    card.className = [
      'note-card',
      `note-card--${effectiveType}`,
      note.completed ? 'note-card--completed' : '',
      !note.completed && expired ? 'note-card--expired' : ''
    ].filter(Boolean).join(' ');
    card.dataset.id = note.id;

    // 顶部行：复选框 + 正文
    const row = document.createElement('div');
    row.className = 'note-card__row';

    const check = document.createElement('div');
    check.className = 'note-card__check';
    check.title = note.completed ? '标记为未完成' : '标记为已完成';
    check.addEventListener('click', async (e) => {
      e.stopPropagation();
      await state.updateNote(note.id, { completed: !note.completed });
    });
    row.appendChild(check);

    const body = document.createElement('div');
    body.className = 'note-card__body';
    body.contentEditable = 'true';
    body.textContent = note.content;

    const saveDebounced = debounce(async () => {
      await state.updateNote(note.id, { content: body.textContent });
    }, 300);

    body.addEventListener('input', saveDebounced);
    row.appendChild(body);
    card.appendChild(row);

    // 底部行：日期 / 时间 / 删除
    const meta = document.createElement('div');
    meta.className = 'note-card__meta';

    if (note.type === 'timeline') {
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.className = 'note-card__date';
      dateInput.value = note.customDate || '';
      dateInput.addEventListener('change', async () => {
        await state.updateNote(note.id, { customDate: dateInput.value });
      });
      meta.appendChild(dateInput);
    }

    const time = document.createElement('span');
    time.className = 'note-card__time';
    time.textContent = formatTime(note.createdAt);

    const delBtn = document.createElement('button');
    delBtn.className = 'note-card__delete';
    delBtn.innerHTML = '&times;';
    delBtn.title = '删除';
    delBtn.addEventListener('click', async () => {
      await state.deleteNote(note.id);
    });

    meta.appendChild(time);
    meta.appendChild(delBtn);
    card.appendChild(meta);

    if (!note.content) {
      setTimeout(() => body.focus(), 50);
    }

    return card;
  }

  function isExpired(note) {
    if (note.type !== 'timeline' || !note.customDate || note.completed) return false;
    const todayStr = new Date().toISOString().slice(0, 10);
    return note.customDate < todayStr;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) {
      if (!b.has(v)) return false;
    }
    return true;
  }

  return { init, setSearch };
})();
