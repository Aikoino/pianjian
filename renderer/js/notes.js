const notes = (() => {
  let lastRendered = new Map(); // id → { key, element }
  let searchQuery = '';

  // ---- Markdown 渲染缓存 ----
  const mdCache = new Map(); // content → HTML
  const MD_CACHE_MAX = 50;

  function mdCacheGet(content) {
    if (!content) return '';
    const hit = mdCache.get(content);
    if (hit !== undefined) return hit;
    return null; // miss
  }

  function mdCacheSet(content, html) {
    if (!content) return;
    if (mdCache.size >= MD_CACHE_MAX) {
      // LRU：删除最早的条目
      const firstKey = mdCache.keys().next().value;
      mdCache.delete(firstKey);
    }
    mdCache.set(content, html);
  }

  // ---- Markdown 渲染（单正则 + 缓存） ----
  // 合并 9 个正则为 1 个，单次遍历处理所有行内标记
  const INLINE_RE = /(`[^`]+`)|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(__(.+?)__)|(\*(.+?)\*)|(_(.+?)_)|(~~(.+?)~~)|(!\[([^\]]*)\]\s*\(([^)]+)\))|(\[([^\]]+)\]\s*\(([^)]+)\))/g;

  function renderInline(text) {
    return text.replace(INLINE_RE, (
      _match, code, _b1, boldEm, _b2, bold, _b3, boldUl,
      _b4, em, _b5, emUl, _b6, del,
      _b7, imgAlt, imgSrc, _b8, linkText, linkHref
    ) => {
      if (code) return '<code>' + code.slice(1, -1).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code>';
      if (boldEm) return '<strong><em>' + boldEm + '</em></strong>';
      if (bold) return '<strong>' + bold + '</strong>';
      if (boldUl) return '<strong>' + boldUl + '</strong>';
      if (em) return '<em>' + em + '</em>';
      if (emUl) return '<em>' + emUl + '</em>';
      if (del) return '<del>' + del + '</del>';
      if (imgSrc) {
        const escapedAlt = (imgAlt || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        let safeSrc = imgSrc.replace(/"/g, '%22');
        // 本地绝对路径转为 local-img:// 协议
        if (/^[a-zA-Z]:\\|^\/[a-zA-Z]/.test(safeSrc) || safeSrc.startsWith('file://') || safeSrc.startsWith('file:///')) {
          safeSrc = 'local-img://' + safeSrc.replace(/^file:\/\/\/?/, '');
        }
        return '<img src="' + safeSrc + '" alt="' + escapedAlt + '" style="max-width:100%;border-radius:4px">';
      }
      if (linkHref) {
        // 协议白名单：只允许 http/https
        let safeHref = linkHref;
        try {
          const parsed = new URL(linkHref);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') safeHref = '#';
        } catch { safeHref = '#'; }
        const escapedLinkText = (linkText || linkHref).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return '<a href="' + safeHref + '" target="_blank" rel="noopener">' + escapedLinkText + '</a>';
      }
      return _match;
    });
  }

  // stripInline：去除 Markdown 标记，提取纯文本
  const STRIP_RE = /(`[^`]+`)|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(__(.+?)__)|(\*(.+?)\*)|(_(.+?)_)|(~~(.+?)~~)|(!\[([^\]]*)\]\([^)]+\))|(\[([^\]]+)\]\([^)]+\))/g;

  function stripInline(text) {
    return text.replace(STRIP_RE, (
      _match, code, _b1, boldEm, _b2, bold, _b3, boldUl,
      _b4, em, _b5, emUl, _b6, del,
      _b7, imgAlt, _b8, linkText
    ) => {
      if (code) return code.slice(1, -1);
      if (boldEm) return boldEm;
      if (bold) return bold;
      if (boldUl) return boldUl;
      if (em) return em;
      if (emUl) return emUl;
      if (del) return del;
      if (imgAlt) return imgAlt;
      if (linkText) return linkText;
      return _match;
    });
  }

  function renderMarkdown(content) {
    if (!content) return '';
    // 缓存命中
    const cached = mdCacheGet(content);
    if (cached !== null) return cached;

    const lines = content.split('\n');
    const html = [];
    let inUl = false, inOl = false, inBq = false, inCode = false;

    function closeLists() {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    }
    function closeBlockquote() { if (inBq) { html.push('</blockquote>'); inBq = false; } }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 围栏代码块（支持 ```code 同行）
      if (/^```/.test(line)) {
        closeLists(); closeBlockquote();
        if (inCode) { html.push('</code></pre>'); inCode = false; }
        else {
          const rest = line.slice(3);
          if (rest.trim()) html.push('<pre><code>' + rest.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
          else html.push('<pre><code>');
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        // 检查行尾是否有 ```（提取时可能被合并）
        const closeMatch = line.match(/^(.*?)```$/);
        if (closeMatch) {
          if (closeMatch[1]) html.push(closeMatch[1].replace(/</g, '&lt;').replace(/>/g, '&gt;'));
          html.push('</code></pre>');
          inCode = false;
        } else {
          html.push(line.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        }
        continue;
      }

      // 分割线
      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
        closeLists(); closeBlockquote();
        html.push('<hr>');
        continue;
      }

      // 无序列表
      if (/^[-*+]\s+/.test(line)) {
        closeBlockquote();
        if (!inOl && !inUl) { html.push('<ul>'); inUl = true; }
        else if (inOl) { html.push('</ol>'); inOl = false; html.push('<ul>'); inUl = true; }
        html.push('<li>' + renderInline(line.replace(/^[-*+]\s+/, '')) + '</li>');
        continue;
      }
      // 有序列表
      if (/^\d+\.\s+/.test(line)) {
        closeBlockquote();
        if (!inUl && !inOl) { html.push('<ol>'); inOl = true; }
        else if (inUl) { html.push('</ul>'); inUl = false; html.push('<ol>'); inOl = true; }
        html.push('<li>' + renderInline(line.replace(/^\d+\.\s+/, '')) + '</li>');
        continue;
      }

      closeLists();

      // 引用块
      if (/^>\s?/.test(line)) {
        if (!inBq) { html.push('<blockquote>'); inBq = true; }
        html.push('<p>' + renderInline(line.replace(/^>\s?/, '')) + '</p>');
        continue;
      }
      closeBlockquote();

      // 标题
      if (/^#{3}\s*\S/.test(line)) {
        html.push('<h3>' + renderInline(line.replace(/^#{3}\s*/, '')) + '</h3>');
      } else if (/^#{2}\s*\S/.test(line)) {
        html.push('<h2>' + renderInline(line.replace(/^#{2}\s*/, '')) + '</h2>');
      } else if (/^#\s*\S/.test(line)) {
        html.push('<h1>' + renderInline(line.replace(/^#\s*/, '')) + '</h1>');
      } else if (line === '') {
        html.push('<br>');
      } else {
        html.push('<p>' + renderInline(line) + '</p>');
      }
    }
    closeLists(); closeBlockquote();
    if (inCode) html.push('</code></pre>');
    const result = html.join('');
    mdCacheSet(content, result);
    return result;
  }

  // 提取第一行作为摘要（去除 Markdown 标记）
  function stripMarkdown(content) {
    if (!content) return '';
    const firstLine = content.split('\n')[0] || '';
    return stripInline(firstLine.replace(/^#{1,3}\s*/, '').replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')).trim();
  }

  function getFiltered() {
    const allNotes = state.getNotes();
    const typeFilter = sidebar.getFilter();

    // 回收站视图
    if (typeFilter === 'trash') {
      return allNotes.filter(n => n.deletedAt);
    }

    // 全部视图：只排除已删除
    if (typeFilter === 'all') {
      return allNotes.filter(n => {
        if (n.deletedAt) return false;
        if (searchQuery && !(n.content || '').toLowerCase().includes(searchQuery)) return false;
        return true;
      });
    }

    // 分类视图：排除已删除，匹配类型
    return allNotes.filter(n => {
      if (n.deletedAt) return false;
      if (typeFilter === 'timeline') {
        if (n.type !== 'timeline') return false;
      } else {
        if (getEffectiveType(n) !== typeFilter) return false;
      }
      if (searchQuery && !(n.content || '').toLowerCase().includes(searchQuery)) return false;
      return true;
    });
  }

  // 渲染键：涵盖所有影响卡片呈现的字段
  // 注意：不包含 updatedAt/content，避免编辑时防抖保存触发重建导致退出编辑模式
  // 同步更新通过 forceRender 标记触发全量重渲染
  function renderKey(n) {
    return `${n.id}:${n.completed ? 1 : 0}:${getEffectiveType(n)}:${n.collapsed ? 1 : 0}:${n.remindAt || ''}:${n.deletedAt || ''}`;
  }

  function init() {
    state.onChange(() => {
      const filtered = getFiltered();
      let changed = false;
      if (filtered.length !== lastRendered.size) {
        changed = true;
      } else {
        // 同时检测 renderKey 变化和顺序变化
        const lastIds = Array.from(lastRendered.keys());
        for (let i = 0; i < filtered.length; i++) {
          const note = filtered[i];
          const prev = lastRendered.get(note.id);
          if (!prev || prev.key !== renderKey(note) || lastIds[i] !== note.id) {
            changed = true;
            break;
          }
        }
      }
      if (changed) render();
    });
    sidebar.onFilterChange(() => render());

    // 监听主进程提醒触发：更新本地状态、高亮卡片、重渲染
    window.electronAPI.onReminderTriggered((noteId) => {
      state.onReminderTriggeredFromMain(noteId);
      // 触发闪烁高亮视觉反馈
      const card = document.querySelector(`.note-card[data-id="${noteId}"]`);
      if (card) {
        card.classList.add('note-card--reminder-flash');
        setTimeout(() => card.classList.remove('note-card--reminder-flash'), 2000);
      }
    });

    // 笔记区域空白处右键：新建便签
    const notesArea = document.getElementById('notes-area');
    notesArea.addEventListener('contextmenu', (e) => {
      // 如果右键在卡片上，由卡片自己的 handler 处理
      if (e.target.closest('.note-card')) return;
      e.preventDefault();
      const typeFilter = sidebar.getFilter();
      if (typeFilter === 'trash') return;
      contextMenu.show(e.clientX, e.clientY, [
        { label: '今日待办', icon: '🔴', action: () => { state.addNote('daily'); sidebar.setActive('daily'); } },
        { label: '周待办', icon: '🟠', action: () => { state.addNote('weekly'); sidebar.setActive('weekly'); } },
        { label: '普通便签', icon: '🟢', action: () => { state.addNote('normal'); sidebar.setActive('normal'); } },
        { label: '时间轴', icon: '🩷', action: () => { state.addNote('timeline'); sidebar.setActive('timeline'); } },
      ]);
    });

    render();
  }

  // 全局点击关闭提醒弹窗
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.note-card__reminder-popup.visible').forEach(popup => {
      if (!popup.contains(e.target) && !e.target.closest('.note-card__reminder-bell')) {
        popup.classList.remove('visible');
      }
    });
  });

  function setSearch(query) {
    searchQuery = query.trim().toLowerCase();
    render();
  }

  function render() {
    const container = document.getElementById('notes-area');
    try {
      renderInner(container);
    } catch (e) {
      console.error('渲染错误:', e);
      container.innerHTML = `<div class="notes-empty"><span style="color:red">渲染出错: ${e.message}</span></div>`;
    }
  }

  function renderInner(container) {
    const filtered = getFiltered();
    const isTrash = sidebar.getFilter() === 'trash';

    // 清理上一次渲染遗留的提醒弹窗（挂在 document.body 上）
    document.querySelectorAll('.note-card__reminder-popup').forEach(el => el.remove());

    if (filtered.length === 0) {
      lastRendered.clear();
      container.innerHTML = '';
      const msg = isTrash
        ? '回收站是空的'
        : searchQuery
          ? '没有匹配的便签'
          : '暂无便签，点击 + 添加';
      container.innerHTML = `
        <div class="notes-empty">
          <span class="notes-empty__icon">${isTrash ? '&#x1F5D1;' : '&#x1F4DD;'}</span>
          <span>${msg}</span>
        </div>`;
      return;
    }

    // 回收站：全量重建（简单场景，不需要 diff）
    if (isTrash) {
      lastRendered.clear();
      container.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'trash-header';
      header.innerHTML = `<span>${filtered.length} 个已删除便签（30天后自动清除）</span>`;
      const purgeBtn = document.createElement('button');
      purgeBtn.className = 'trash-purge-btn';
      purgeBtn.textContent = '清空回收站';
      purgeBtn.addEventListener('click', async () => {
        if (confirm('确定清空回收站？所有便签将被彻底删除。')) {
          for (const n of filtered) {
            await state.permanentDeleteNote(n.id);
          }
        }
      });
      header.appendChild(purgeBtn);
      container.appendChild(header);
      filtered.forEach(note => {
        const el = createTrashCard(note);
        container.appendChild(el);
        // 记录到 lastRendered，确保切换视图时 diff 能正确移除
        lastRendered.set(note.id, { key: 'trash', element: el });
      });
      return;
    }

    // ---- Diff 模式：复用未变化的卡片 ----
    const newRendered = new Map();
    const newIds = new Set(filtered.map(n => n.id));

    // 1. 复用或重建卡片
    const cards = [];
    for (const note of filtered) {
      const key = renderKey(note);
      const prev = lastRendered.get(note.id);
      if (prev && prev.key === key) {
        newRendered.set(note.id, prev);
        cards.push(prev.element);
      } else {
        const el = createCard(note);
        newRendered.set(note.id, { key, element: el });
        cards.push(el);
      }
    }

    // 2. 移除不再显示的卡片、回收站 header、尾部拖放区域
    for (const [id, entry] of lastRendered) {
      if (!newIds.has(id)) {
        entry.element.remove();
      }
    }
    const cardSet = new Set(cards);
    Array.from(container.children).forEach(child => {
      if (!cardSet.has(child) && !child.classList.contains('note-card__trailing-zone')) {
        child.remove();
      }
    });

    // 3. 按正确顺序排列卡片到容器
    const oldTrailing = container.querySelector('.note-card__trailing-zone');
    if (oldTrailing) oldTrailing.remove();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const ref = container.children[i];
      if (ref !== card) {
        container.insertBefore(card, ref || null);
      }
    }

    // 4. 尾部拖放区域（普通便签视图）
    if (sidebar.getFilter() === 'normal') {
      const trailingZone = document.createElement('div');
      trailingZone.className = 'note-card__trailing-zone';
      trailingZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        trailingZone.classList.add('note-card--drag-over-bottom');
      });
      trailingZone.addEventListener('dragleave', () => {
        trailingZone.classList.remove('note-card--drag-over-bottom');
      });
      trailingZone.addEventListener('drop', (e) => {
        e.preventDefault();
        trailingZone.classList.remove('note-card--drag-over-bottom');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId) {
          state.reorderNotes(draggedId, null, 'end');
        }
      });
      container.appendChild(trailingZone);
    }

    lastRendered = newRendered;
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

    // 检测多行：基于原始 note.content（非 innerHTML）
    function hasMultipleLines(content) {
      if (typeof content === 'string') {
        return content.includes('\n');
      }
      return false;
    }

  // 回收站卡片
  function createTrashCard(note) {
    const card = document.createElement('div');
    card.className = 'note-card note-card--trash';
    card.dataset.id = note.id;

    const content = document.createElement('div');
    content.className = 'note-card__trash-content';
    const firstLine = stripMarkdown(note.content || '').split('\n')[0].trim() || '(无内容)';
    content.textContent = firstLine;
    card.appendChild(content);

    const meta = document.createElement('div');
    meta.className = 'note-card__trash-meta';
    const delTime = new Date(note.deletedAt);
    const pad = n => String(n).padStart(2, '0');
    meta.textContent = `删除于 ${delTime.getMonth()+1}/${delTime.getDate()} ${pad(delTime.getHours())}:${pad(delTime.getMinutes())}`;
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'note-card__trash-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'note-card__trash-btn note-card__trash-btn--restore';
    restoreBtn.textContent = '恢复';
    restoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.restoreNote(note.id);
    });

    const permDelBtn = document.createElement('button');
    permDelBtn.className = 'note-card__trash-btn note-card__trash-btn--delete';
    permDelBtn.textContent = '彻底删除';
    permDelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('确定彻底删除此便签？')) {
        state.permanentDeleteNote(note.id);
      }
    });

    actions.appendChild(restoreBtn);
    actions.appendChild(permDelBtn);
    card.appendChild(actions);

    return card;
  }

  // ---- 提醒控件：铃铛按钮 + 弹出日期时间面板 ----
  function createReminderControl(note) {
    const reminderEl = document.createElement('span');
    reminderEl.className = 'note-card__reminder';

    const bellBtn = document.createElement('button');
    bellBtn.className = 'note-card__reminder-bell';
    bellBtn.textContent = '\u{1F514}';
    if (note.remindAt) {
      bellBtn.classList.add('active');
      const d = new Date(note.remindAt);
      const pad = n => String(n).padStart(2, '0');
      const repeat = note.reminderRepeat || 'none';
      const repeatLabels = { none: '', daily: ' 每天', weekly: ' 每周', monthly: ' 每月', yearly: ' 每年' };
      let repeatStr = repeatLabels[repeat] || '';
      if (repeat === 'custom') repeatStr = ` 每${note.reminderRepeatInterval || 1}天`;
      if (repeat === 'weekly' && note.reminderRepeatDays) {
        const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
        repeatStr = ' 每周' + note.reminderRepeatDays.map(d => dayLabels[d]).join('/');
      }
      bellBtn.title = `提醒: ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${repeatStr}`;
    } else {
      bellBtn.title = '设置提醒';
    }

    const popup = document.createElement('div');
    popup.className = 'note-card__reminder-popup';

    // ---- 快捷选项（从配置加载） ----
    const quickRow = document.createElement('div');
    quickRow.className = 'note-card__reminder-quick';

    async function loadQuickButtons() {
      quickRow.innerHTML = '';
      const presets = await window.electronAPI.getReminderPresets();
      console.log('[quick] 加载预设:', JSON.stringify(presets));
      presets.forEach(preset => {
        const btn = document.createElement('button');
        btn.className = 'note-card__reminder-quick-btn';
        btn.textContent = preset.label;
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const target = calcPreset(preset);
          if (target) {
            await state.setReminder(note.id, target.toISOString());
            popup.classList.remove('visible');
          }
        });
        quickRow.appendChild(btn);
      });
      // 管理按钮
      const editBtn = document.createElement('button');
      editBtn.className = 'note-card__reminder-quick-btn note-card__reminder-quick-btn--edit';
      editBtn.textContent = '⚙';
      editBtn.title = '管理快捷选项';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showPresetManager(popup);
      });
      quickRow.appendChild(editBtn);
    }
    loadQuickButtons();
    // 预设更新后刷新按钮
    quickRow.addEventListener('presetsUpdated', () => loadQuickButtons());
    popup.appendChild(quickRow);

    function calcPreset(preset) {
      const now = new Date();
      switch (preset.type) {
        case 'minutes': {
          const d = new Date(now);
          d.setMinutes(d.getMinutes() + preset.value);
          return d;
        }
        case 'hours': {
          const d = new Date(now);
          d.setHours(d.getHours() + preset.value);
          return d;
        }
        case 'tomorrow': {
          const d = new Date(now);
          d.setDate(d.getDate() + 1);
          d.setHours(preset.hour || 9, preset.minute || 0, 0, 0);
          return d;
        }
        case 'nextWeekday': {
          const d = new Date(now);
          const target = preset.weekday ?? 1;
          const daysUntil = (target - d.getDay() + 7) % 7 || 7;
          d.setDate(d.getDate() + daysUntil);
          d.setHours(preset.hour || 9, preset.minute || 0, 0, 0);
          return d;
        }
        default: return null;
      }
    }

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'note-card__reminder-date-input';
    if (note.remindAt) {
      dateInput.value = new Date(note.remindAt).toISOString().slice(0, 10);
    } else if (note.type === 'timeline' && note.customDate) {
      dateInput.value = note.customDate;
    } else {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.className = 'note-card__reminder-time-input';
    if (note.remindAt) {
      const d = new Date(note.remindAt);
      timeInput.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    const repeatRow = document.createElement('div');
    repeatRow.className = 'note-card__reminder-repeat';
    const repeatLabel = document.createElement('span');
    repeatLabel.className = 'note-card__reminder-repeat-label';
    repeatLabel.textContent = '重复';
    const repeatSelect = document.createElement('select');
    repeatSelect.className = 'note-card__reminder-repeat-select';
    ['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'].forEach(val => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = { none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年', custom: '自定义' }[val];
      repeatSelect.appendChild(opt);
    });
    repeatSelect.value = note.reminderRepeat || 'none';

    const weekDaysRow = document.createElement('div');
    weekDaysRow.className = 'note-card__reminder-weekdays';
    weekDaysRow.style.display = repeatSelect.value === 'weekly' ? 'flex' : 'none';
    const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
    const weekChecks = [];
    WEEK_LABELS.forEach((label, i) => {
      const lbl = document.createElement('label');
      lbl.className = 'note-card__reminder-weekday';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = i;
      cb.checked = (note.reminderRepeatDays || []).includes(i);
      cb.addEventListener('click', e => e.stopPropagation());
      weekChecks.push(cb);
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(label));
      lbl.addEventListener('click', e => { e.stopPropagation(); cb.checked = !cb.checked; });
      weekDaysRow.appendChild(lbl);
    });

    const customRow = document.createElement('div');
    customRow.className = 'note-card__reminder-custom';
    customRow.style.display = repeatSelect.value === 'custom' ? 'flex' : 'none';
    const customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.min = '1';
    customInput.max = '365';
    customInput.value = note.reminderRepeatInterval || 1;
    customInput.className = 'note-card__reminder-custom-input';
    const customUnit = document.createElement('span');
    customUnit.textContent = '天';
    customRow.appendChild(customInput);
    customRow.appendChild(customUnit);

    repeatSelect.addEventListener('change', () => {
      weekDaysRow.style.display = repeatSelect.value === 'weekly' ? 'flex' : 'none';
      customRow.style.display = repeatSelect.value === 'custom' ? 'flex' : 'none';
    });

    repeatRow.appendChild(repeatLabel);
    repeatRow.appendChild(repeatSelect);
    popup.appendChild(dateInput);
    popup.appendChild(timeInput);
    popup.appendChild(repeatRow);
    popup.appendChild(weekDaysRow);
    popup.appendChild(customRow);

    const popupRow = document.createElement('div');
    popupRow.className = 'note-card__reminder-popup-row';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'note-card__reminder-confirm';
    confirmBtn.textContent = '\u{2714} \u{786E}\u{5B9A}';
    confirmBtn.title = note.remindAt ? '更新提醒' : '设置提醒';
    confirmBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (dateInput.value && timeInput.value) {
        const [y, m, d] = dateInput.value.split('-').map(Number);
        const [hours, minutes] = timeInput.value.split(':').map(Number);
        const remindAt = new Date(y, m - 1, d, hours, minutes).toISOString();
        const repeat = repeatSelect.value;
        const changes = { remindAt };
        if (repeat !== 'none') {
          changes.reminderRepeat = repeat;
          if (repeat === 'weekly') {
            changes.reminderRepeatDays = weekChecks.filter(cb => cb.checked).map(cb => Number(cb.value));
          } else if (repeat === 'custom') {
            changes.reminderRepeatInterval = Number(customInput.value) || 1;
          }
        } else {
          changes.reminderRepeat = 'none';
          changes.reminderRepeatDays = undefined;
          changes.reminderRepeatInterval = undefined;
        }
        await state.updateNote(note.id, changes);
        popup.classList.remove('visible');
      }
    });
    popupRow.appendChild(confirmBtn);

    if (note.remindAt) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'note-card__reminder-popup-cancel';
      cancelBtn.textContent = '\u{2716} \u{53D6}\u{6D88}\u{63D0}\u{9192}';
      cancelBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await state.setReminder(note.id, null);
        popup.classList.remove('visible');
      });
      popupRow.appendChild(cancelBtn);
    }

    popup.appendChild(popupRow);

    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.note-card__reminder-popup.visible').forEach(p => {
        if (p !== popup) p.classList.remove('visible');
      });
      const rect = bellBtn.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceRight = window.innerWidth - rect.right;
      popup.style.left = spaceRight >= 200 ? (rect.right + 4) + 'px' : (rect.left - 200) + 'px';
      popup.style.right = 'auto';
      popup.style.top = 'auto';
      popup.style.bottom = 'auto';
      if (spaceBelow >= 140) {
        popup.style.top = (rect.bottom + 4) + 'px';
      } else if (spaceAbove >= 140) {
        popup.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      } else {
        popup.style.top = (rect.bottom + 4) + 'px';
      }
      popup.classList.toggle('visible');
    });

    reminderEl.appendChild(bellBtn);
    document.body.appendChild(popup);
    return reminderEl;
  }

  function createCard(note) {
    const card = document.createElement('div');
    const effectiveType = getEffectiveType(note);
    const expired = isExpired(note);
    // 折叠判断：显式 collapsed 字段优先，旧便签（undefined）按多行自动折叠
    const shouldCollapse = note.collapsed === true ||
      (note.collapsed === undefined && hasMultipleLines(note.content));

    card.className = [
      'note-card',
      `note-card--${effectiveType}`,
      note.completed ? 'note-card--completed' : '',
      !note.completed && expired ? 'note-card--expired' : '',
      shouldCollapse ? 'note-card--collapsed' : ''
    ].filter(Boolean).join(' ');
    card.dataset.id = note.id;

    // 拖拽排序（仅普通便签，通过左侧拖拽手柄）
    if (effectiveType === 'normal' && !note.completed) {
      card.draggable = true;
      const dragHandle = document.createElement('span');
      dragHandle.className = 'note-card__drag-handle';
      dragHandle.textContent = '⋮';
      dragHandle.title = '拖拽排序';
      card.insertBefore(dragHandle, card.firstChild);

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', note.id);
        card.classList.add('note-card--dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('note-card--dragging');
        document.querySelectorAll('.note-card--drag-over').forEach(c => c.classList.remove('note-card--drag-over'));
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.types.includes('text/plain') && e.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== note.id) {
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          card.classList.remove('note-card--drag-over-top', 'note-card--drag-over-bottom');
          if (e.clientY < midY) {
            card.classList.add('note-card--drag-over-top');
          } else {
            card.classList.add('note-card--drag-over-bottom');
          }
        }
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('note-card--drag-over-top', 'note-card--drag-over-bottom');
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('note-card--drag-over-top', 'note-card--drag-over-bottom');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== note.id) {
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const position = e.clientY < midY ? 'before' : 'after';
          state.reorderNotes(draggedId, note.id, position);
        }
      });
    }

    // ---- 折叠摘要 ----
    const summary = document.createElement('div');
    summary.className = 'note-card__summary';

    // 摘要中的复选框（折叠时可勾选）
    const summaryCheck = document.createElement('div');
    summaryCheck.className = 'note-card__check note-card__check--summary';
    summaryCheck.title = note.completed ? '标记为未完成' : '标记为已完成';
    summaryCheck.addEventListener('click', async (e) => {
      e.stopPropagation();
      await state.updateNote(note.id, { completed: !note.completed });
    });

    const summaryText = document.createElement('span');
    summaryText.className = 'note-card__summary-text';

    const summaryExpandBtn = document.createElement('span');
    summaryExpandBtn.className = 'note-card__toggle';
    summaryExpandBtn.textContent = '展开';
    summaryExpandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      expand();
    });

    summary.appendChild(summaryCheck);
    summary.appendChild(summaryText);
    summary.appendChild(summaryExpandBtn);

    function updateSummary() {
      const firstLine = stripMarkdown(note.content || '').split('\n')[0].trim();
      summaryText.textContent = firstLine || '(无标题)';
    }
    updateSummary();

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

    // 从 contenteditable innerHTML 正确提取纯文本（保留 <br> 换行）
    function extractTextFromHtml(html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      function walk(node) {
        let r = '';
        for (const c of node.childNodes) {
          if (c.nodeType === 3) r += c.textContent;
          else if (c.nodeType === 1) {
            if (c.tagName === 'BR') r += '\n';
            else if (['DIV', 'P'].includes(c.tagName)) {
              if (r.length > 0 && !r.endsWith('\n')) r += '\n';
              r += walk(c);
            } else r += walk(c);
          }
        }
        return r;
      }
      return walk(tmp);
    }

    let isEditing = false;

    // ---- 格式工具栏 ----
    const toolbar = document.createElement('div');
    toolbar.className = 'note-card__toolbar';
    const TOOLBAR_ITEMS = [
      { label: 'B', title: '粗体 (Ctrl+B)', wrap: ['**', '**'] },
      { label: 'I', title: '斜体 (Ctrl+I)', wrap: ['*', '*'] },
      { label: 'S', title: '删除线', wrap: ['~~', '~~'] },
      { label: '<>', title: '行内代码', wrap: ['`', '`'] },
      { label: '|', title: '引用', prefix: '> ' },
      { label: '#', title: '标题', prefix: '# ' },
      { label: '•', title: '无序列表', prefix: '- ' },
      { label: '1.', title: '有序列表', prefix: '1. ' },
      { label: '{}', title: '代码块', wrap: ['```\n', '\n```'] },
      { label: '🔗', title: '链接', wrap: ['[', '](url)'] },
    ];
    TOOLBAR_ITEMS.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'note-card__toolbar-btn';
      btn.textContent = item.label;
      btn.title = item.title;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 防止 body 失焦
        applyFormat(item);
      });
      toolbar.appendChild(btn);
    });
    toolbar.style.display = 'none';

    function applyFormat(item) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      // 确保选区在 body 内
      if (!body.contains(range.commonAncestorContainer)) return;

      const selected = sel.toString();

      if (item.wrap) {
        const [pre, suf] = item.wrap;
        if (selected) {
          // 有选中文本：包裹
          const replacement = pre + selected + suf;
          range.deleteContents();
          range.insertNode(document.createTextNode(replacement));
        } else {
          // 无选中文本：插入标记，光标移到中间
          const marker = pre + suf;
          range.insertNode(document.createTextNode(marker));
          // 将光标移到 pre 和 suf 之间
          range.setStart(range.startContainer, range.startOffset - suf.length);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } else if (item.prefix) {
        // 行前缀（标题、列表）：在行首插入
        const lineRange = document.createRange();
        let node = range.startContainer;
        // 找到行首
        while (node !== body && node.previousSibling) {
          if (node.nodeType === 3 && node.textContent.includes('\n')) break;
          node = node.previousSibling || node.parentNode;
        }
        // 简单方案：在选中文本前插入前缀
        if (selected) {
          const replacement = item.prefix + selected;
          range.deleteContents();
          range.insertNode(document.createTextNode(replacement));
        } else {
          range.insertNode(document.createTextNode(item.prefix));
          range.setStart(range.startContainer, range.startOffset);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      // 触发 input 事件以保存
      body.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 显示模式：渲染 Markdown HTML，不可编辑
    function showDisplayMode() {
      isEditing = false;
      body.contentEditable = 'false';
      body.innerHTML = renderMarkdown(note.content);
      body.classList.remove('note-card__body--editing');
      toolbar.style.display = 'none';
    }

    // 编辑模式：显示原始 Markdown，可编辑
    function showEditMode() {
      isEditing = true;
      body.contentEditable = 'true';
      body.textContent = note.content;
      body.classList.add('note-card__body--editing');
      toolbar.style.display = '';
      body.focus();
      placeCaretAtEnd(body);
    }

    // 从编辑模式退出，保存内容并切回显示模式
    function exitEditMode() {
      if (!isEditing) return;
      const content = extractTextFromHtml(body.innerHTML);
      // 如果内容没变，只切模式不触发状态更新
      if (content === note.content) {
        showDisplayMode();
        return;
      }
      note.content = content;
      // 直接切回显示模式（用新内容渲染），不等 state 重建卡片
      isEditing = false;
      body.contentEditable = 'false';
      body.innerHTML = renderMarkdown(content);
      body.classList.remove('note-card__body--editing');
      // 同步到主进程 + 本地 state（不触发 notify，避免卡片重建）
      window.electronAPI.updateNote(note.id, { content });
    }

    // 收起/展开按钮（放在卡片右上角，紧邻内容）
    const toggleBtn = document.createElement('span');
    toggleBtn.className = 'note-card__toggle';
    toggleBtn.textContent = shouldCollapse ? '展开' : '收起';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (card.classList.contains('note-card--collapsed')) {
        expand();
      } else {
        if (isEditing) exitEditMode();
        tryCollapse();
      }
    });

    // 初始状态：显示模式
    showDisplayMode();
    if (shouldCollapse) {
      toggleBtn.style.display = 'none';
      summaryExpandBtn.style.display = '';
    } else {
      summaryExpandBtn.style.display = 'none';
    }

    const saveDebounced = debounce(async () => {
      const content = extractTextFromHtml(body.innerHTML);
      note.content = content;
      // 直接写主进程，不触发 state.notify（避免编辑时卡片重建）
      window.electronAPI.updateNote(note.id, { content });
    }, 300);

    body.addEventListener('input', saveDebounced);

    // body 点击：显示模式 → 编辑模式（链接点击不触发）
    body.addEventListener('click', (e) => {
      if (!isEditing && !e.target.closest('a')) {
        e.stopPropagation();
        showEditMode();
      }
    });
    row.appendChild(body);
    card.appendChild(toolbar);
    card.appendChild(row);

    // 底部行：日期 / 时间 / 删除 / 提醒
    const meta = document.createElement('div');
    meta.className = 'note-card__meta';

    const metaLeft = document.createElement('span');
    metaLeft.className = 'note-card__meta-left';

    const metaRight = document.createElement('span');
    metaRight.className = 'note-card__meta-right';

    if (note.type === 'timeline') {
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.className = 'note-card__date';
      dateInput.value = note.customDate || '';
      dateInput.addEventListener('change', async () => {
        await state.updateNote(note.id, { customDate: dateInput.value });
      });
      metaLeft.appendChild(dateInput);
    }

    // ---- 提醒控件 ----
    if (note.type === 'daily' || note.type === 'weekly' || note.type === 'timeline') {
      metaLeft.appendChild(createReminderControl(note));
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'note-card__delete';
    delBtn.innerHTML = '&times;';
    delBtn.title = `删除 · ${formatTime(note.createdAt)}`;
    delBtn.addEventListener('click', async () => {
      await state.deleteNote(note.id);
    });

    metaRight.appendChild(toggleBtn);
    metaRight.appendChild(delBtn);
    meta.appendChild(metaLeft);
    meta.appendChild(metaRight);
    card.appendChild(meta);

    // ---- 折叠/展开交互 ----

    // 摘要点击 → 展开到显示模式
    summary.addEventListener('click', (e) => {
      e.stopPropagation();
      expand();
    });

    // 卡片点击：折叠→展开，显示→编辑（排除按钮、链接和弹窗）
    card.addEventListener('click', (e) => {
      if (e.target.closest('.note-card__check, .note-card__delete, .note-card__reminder, .note-card__toggle, a, .note-card__reminder-popup, .note-card__drag-handle')) return;

      if (card.classList.contains('note-card--collapsed')) {
        expand();
      } else if (!isEditing) {
        showEditMode();
      }
    });

    function expand() {
      card.classList.remove('note-card--collapsed');
      note.collapsed = false;
      showDisplayMode();
      updateSummaryFromBody();
      toggleBtn.textContent = '收起';
      toggleBtn.style.display = '';
      summaryExpandBtn.style.display = 'none';
    }

    // 折叠多行便签
    function tryCollapse() {
      if (!hasMultipleLines(note.content)) return;
      if (!card.classList.contains('note-card--collapsed')) {
        note.collapsed = true;
        updateSummaryFromBody();
        card.classList.add('note-card--collapsed');
        toggleBtn.style.display = 'none';
        summaryExpandBtn.style.display = '';
      }
    }

    // 失焦 → 退出编辑模式
    body.addEventListener('focusout', (e) => {
      if (isEditing && !card.contains(e.relatedTarget)) {
        exitEditMode();
      }
    });

    function updateSummaryFromBody() {
      const firstLine = stripMarkdown(note.content || '').split('\n')[0].trim();
      summaryText.textContent = firstLine || '(无标题)';
    }

    // 摘要插入到卡片顶部
    card.insertBefore(summary, card.firstChild);

    if (!note.content) {
      setTimeout(() => showEditMode(), 50);
    }

    // ---- 右键菜单 ----
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const isTrash = !!note.deletedAt;
      if (isTrash) {
        contextMenu.show(e.clientX, e.clientY, [
          { label: '恢复', icon: '↩', action: () => state.restoreNote(note.id) },
          { sep: true },
          { label: '彻底删除', icon: '🗑', action: () => state.permanentDeleteNote(note.id), danger: true },
        ]);
      } else {
        const items = [
          { label: '复制内容', icon: '📋', action: () => navigator.clipboard.writeText(note.content || '') },
        ];
        if (note.type !== 'normal' || sidebar.getFilter() === 'normal' || sidebar.getFilter() === 'all') {
          items.push({ label: note.completed ? '取消完成' : '标记完成', icon: note.completed ? '↩' : '✓', action: () => state.updateNote(note.id, { completed: !note.completed }) });
        }
        items.push({ label: '设置提醒', icon: '⏰', action: () => {
          const bell = card.querySelector('.note-card__reminder .note-card__bell');
          if (bell) bell.click();
        }});
        items.push({ sep: true });
        items.push({ label: '删除', icon: '🗑', action: () => state.deleteNote(note.id), danger: true });
        contextMenu.show(e.clientX, e.clientY, items);
      }
    });

    return card;
  }

  function isExpired(note) {
    if (note.type !== 'timeline' || !note.customDate || note.completed) return false;
    const today = new Date();
    const todayStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    return note.customDate < todayStr;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 强制全量重渲染（用于同步数据更新后 / 排序后）
  function forceRender() {
    lastRendered.clear();
    render();
  }

  return { init, setSearch, forceRender };
})();
