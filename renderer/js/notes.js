const notes = (() => {
  let lastKeys = new Set();
  let searchQuery = '';

  // ---- Markdown 渲染 ----
  function renderInline(text) {
    let s = text;
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/_(.+?)_/g, '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px">');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  function stripInline(text) {
    let s = text;
    s = s.replace(/`([^`]+)`/g, '$1');
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
    s = s.replace(/\*\*(.+?)\*\*/g, '$1');
    s = s.replace(/__(.+?)__/g, '$1');
    s = s.replace(/\*(.+?)\*/g, '$1');
    s = s.replace(/_(.+?)_/g, '$1');
    s = s.replace(/~~(.+?)~~/g, '$1');
    s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    return s;
  }

  function renderMarkdown(content) {
    if (!content) return '';
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

      // 围栏代码块
      if (/^```/.test(line)) {
        closeLists(); closeBlockquote();
        if (inCode) { html.push('</code></pre>'); inCode = false; }
        else { html.push('<pre><code>'); inCode = true; }
        continue;
      }
      if (inCode) { html.push(line.replace(/</g, '&lt;').replace(/>/g, '&gt;')); continue; }

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
    return html.join('');
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
    return `${n.id}:${n.completed ? 1 : 0}:${getEffectiveType(n)}:${n.collapsed ? 1 : 0}:${n.remindAt || ''}`;
  }

  function init() {
    state.onChange(() => {
      const currentKeys = new Set(getFiltered().map(renderKey));
      if (!setsEqual(lastKeys, currentKeys)) render();
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

    // 显示模式：渲染 Markdown HTML，不可编辑
    function showDisplayMode() {
      isEditing = false;
      body.contentEditable = 'false';
      body.innerHTML = renderMarkdown(note.content);
      body.classList.remove('note-card__body--editing');
    }

    // 编辑模式：显示原始 Markdown，可编辑
    function showEditMode() {
      isEditing = true;
      body.contentEditable = 'true';
      body.textContent = note.content;
      body.classList.add('note-card__body--editing');
      body.focus();
      placeCaretAtEnd(body);
    }

    // 从编辑模式退出，保存内容并切回显示模式
    function exitEditMode() {
      if (!isEditing) return;
      const content = extractTextFromHtml(body.innerHTML);
      note.content = content;
      state.updateNote(note.id, { content });
      showDisplayMode();
    }

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
      await state.updateNote(note.id, { content });
    }, 300);

    body.addEventListener('input', saveDebounced);

    // body 点击：显示模式 → 编辑模式
    body.addEventListener('click', (e) => {
      if (!isEditing) {
        e.stopPropagation();
        showEditMode();
      }
    });
    row.appendChild(body);
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

    // ---- 提醒控件（daily、weekly、timeline 类型）：铃铛按钮 → 弹出日期时间面板 ----
    if (note.type === 'daily' || note.type === 'weekly' || note.type === 'timeline') {
      const reminderEl = document.createElement('span');
      reminderEl.className = 'note-card__reminder';

      // 铃铛按钮
      const bellBtn = document.createElement('button');
      bellBtn.className = 'note-card__reminder-bell';
      bellBtn.textContent = '\u{1F514}';
      if (note.remindAt) {
        bellBtn.classList.add('active');
        const d = new Date(note.remindAt);
        const pad = n => String(n).padStart(2, '0');
        bellBtn.title = `提醒: ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } else {
        bellBtn.title = '设置提醒';
      }

      // 弹出面板
      const popup = document.createElement('div');
      popup.className = 'note-card__reminder-popup';

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

      // 操作按钮行
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
          await state.setReminder(note.id, remindAt);
          popup.classList.remove('visible');
        }
      });
      popupRow.appendChild(confirmBtn);

      // 已设置提醒时显示"取消提醒"按钮
      if (note.remindAt) {
        const cancelReminderBtn = document.createElement('button');
        cancelReminderBtn.className = 'note-card__reminder-popup-cancel';
        cancelReminderBtn.textContent = '\u{2716} \u{53D6}\u{6D88}\u{63D0}\u{9192}';
        cancelReminderBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await state.setReminder(note.id, null);
          popup.classList.remove('visible');
        });
        popupRow.appendChild(cancelReminderBtn);
      }

      popup.appendChild(dateInput);
      popup.appendChild(timeInput);
      popup.appendChild(popupRow);

      // 铃铛点击切换弹窗
      bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 关闭其他所有弹窗
        document.querySelectorAll('.note-card__reminder-popup.visible').forEach(p => {
          if (p !== popup) p.classList.remove('visible');
        });
        // 智能定位：下方优先，上方不够则向下
        const rect = bellBtn.getBoundingClientRect();
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        popup.style.right = (window.innerWidth - rect.right) + 'px';
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
      reminderEl.appendChild(popup);
      metaLeft.appendChild(reminderEl);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'note-card__delete';
    delBtn.innerHTML = '&times;';
    delBtn.title = `删除 · ${formatTime(note.createdAt)}`;
    delBtn.addEventListener('click', async () => {
      await state.deleteNote(note.id);
    });

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

    row.appendChild(toggleBtn);
    meta.appendChild(metaLeft);
    meta.appendChild(metaRight);
    card.appendChild(meta);

    // ---- 折叠/展开交互 ----

    // 摘要点击 → 展开到显示模式
    summary.addEventListener('click', (e) => {
      e.stopPropagation();
      expand();
    });

    // 卡片点击：折叠→展开，显示→编辑（排除按钮区域）
    card.addEventListener('click', (e) => {
      if (e.target.closest('.note-card__check, .note-card__delete, .note-card__reminder, .note-card__toggle')) return;

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
      setTimeout(() => enterEditMode(), 50);
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
