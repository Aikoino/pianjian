function initTitleBar() {
  const addBtn = document.getElementById('btn-add');
  const addPopup = document.getElementById('add-popup');
  const pinBtn = document.getElementById('btn-pin');
  const minBtn = document.getElementById('btn-minimize');
  const searchInput = document.getElementById('search-input');

  // 添加按钮 → 弹出类型选择
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addPopup.classList.toggle('visible');
  });

  // 点击弹窗外关闭
  document.addEventListener('click', (e) => {
    if (!addPopup.contains(e.target) && e.target !== addBtn) {
      addPopup.classList.remove('visible');
    }
  });

  // 类型选择
  addPopup.querySelectorAll('.add-popup__item').forEach(item => {
    item.addEventListener('click', async () => {
      const type = item.dataset.type;
      addPopup.classList.remove('visible');
      const note = await state.addNote(type);
      sidebar.setActive(type);
      console.log('已添加便签:', note.id, note.type);
    });
  });

  // 置顶切换
  pinBtn.addEventListener('click', () => {
    window.electronAPI.togglePin();
  });

  window.electronAPI.onPinChanged((pinned) => {
    pinBtn.classList.toggle('active', pinned);
  });

  // 开机自启切换
  const autoLaunchBtn = document.getElementById('btn-autolaunch');

  window.electronAPI.getAutoLaunch().then((enabled) => {
    autoLaunchBtn.classList.toggle('active', enabled);
  });

  autoLaunchBtn.addEventListener('click', async () => {
    const enabled = !autoLaunchBtn.classList.contains('active');
    autoLaunchBtn.classList.toggle('active', enabled);
    const ok = await window.electronAPI.setAutoLaunch(enabled);
    if (!ok) {
      // 写入失败，回滚 UI 状态
      autoLaunchBtn.classList.toggle('active', !enabled);
    }
  });

  // 最小化
  minBtn.addEventListener('click', () => {
    window.electronAPI.minimize();
  });

  // 关闭
  const closeBtn = document.getElementById('btn-close');
  closeBtn.addEventListener('click', () => {
    window.electronAPI.close();
  });

  // 搜索
  const searchWrap = document.getElementById('search-wrap');
  const searchBtn = document.getElementById('btn-search');

  const doSearch = debounce((query) => {
    notes.setSearch(query);
  }, 300);

  searchInput.addEventListener('input', () => {
    doSearch(searchInput.value);
  });

  function openSearch() {
    searchWrap.classList.add('title-bar__search-wrap--open');
    searchInput.focus();
  }

  function closeSearch() {
    searchWrap.classList.remove('title-bar__search-wrap--open');
    searchInput.value = '';
    doSearch('');
    searchInput.blur();
  }

  searchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (searchWrap.classList.contains('title-bar__search-wrap--open')) {
      closeSearch();
    } else {
      openSearch();
    }
  });

  // 点击搜索区域外关闭
  document.addEventListener('click', (e) => {
    if (!searchWrap.contains(e.target) && searchWrap.classList.contains('title-bar__search-wrap--open')) {
      closeSearch();
    }
  });

  // Escape 关闭
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSearch();
    }
  });

  // ---- 更多菜单 ----
  const moreBtn = document.getElementById('btn-more');
  const moreMenu = document.getElementById('more-menu');

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle('visible');
    if (moreMenu.classList.contains('visible')) {
      const rect = moreBtn.getBoundingClientRect();
      moreMenu.style.top = (rect.bottom + 2) + 'px';
      moreMenu.style.right = (window.innerWidth - rect.right) + 'px';
    }
  });

  document.addEventListener('click', (e) => {
    if (!moreMenu.contains(e.target)) moreMenu.classList.remove('visible');
  });

  // ---- 导出选择面板 ----
  const exportOverlay = document.getElementById('export-overlay');
  const exportPanelTitle = document.getElementById('export-panel-title');
  const exportList = document.getElementById('export-list');
  const exportSelectAll = document.getElementById('export-select-all');
  const exportCount = document.getElementById('export-count');
  const exportConfirm = document.getElementById('export-confirm');
  const exportCancel = document.getElementById('export-cancel');
  const exportPanelClose = document.getElementById('export-panel-close');

  let exportMode = ''; // 'json' | 'markdown'

  const TYPE_COLORS = {
    daily: '#B71C1C', weekly: '#E65100', normal: '#1B5E20', timeline: '#880E4F'
  };
  const TYPE_LABELS = {
    daily: '今日', weekly: '周', normal: '便签', timeline: '时间轴'
  };

  function stripMd(text) {
    return (text || '').replace(/[#*`~>\-\[\]()!_]/g, '').split('\n')[0].trim() || '(无内容)';
  }

  function showExportPanel(mode) {
    exportMode = mode;
    exportPanelTitle.textContent = mode === 'json' ? '选择要备份的便签' : '选择要导出的便签';
    const notes = state.getNotes().filter(n => !n.deletedAt);
    exportList.innerHTML = '';
    exportSelectAll.checked = true;

    notes.forEach(note => {
      const item = document.createElement('label');
      item.className = 'export-panel__item';
      const firstLine = stripMd(note.content);
      item.innerHTML = `
        <input type="checkbox" checked data-id="${note.id}">
        <span class="export-panel__item-label">${firstLine}</span>
        <span class="export-panel__item-type" style="background:${TYPE_COLORS[note.type] || '#999'}">${TYPE_LABELS[note.type] || note.type}</span>
      `;
      exportList.appendChild(item);
    });

    updateExportCount();
    exportOverlay.classList.add('visible');
  }

  function hideExportPanel() {
    exportOverlay.classList.remove('visible');
  }

  function updateExportCount() {
    const checked = exportList.querySelectorAll('input[type="checkbox"]:checked').length;
    const total = exportList.querySelectorAll('input[type="checkbox"]').length;
    exportCount.textContent = `已选 ${checked}/${total}`;
  }

  exportList.addEventListener('change', updateExportCount);

  exportSelectAll.addEventListener('change', () => {
    const checked = exportSelectAll.checked;
    exportList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = checked);
    updateExportCount();
  });

  function getSelectedIds() {
    const ids = [];
    exportList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => ids.push(cb.dataset.id));
    return ids;
  }

  exportConfirm.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (ids.length === 0) { alert('请至少选择一条便签'); return; }
    hideExportPanel();
    if (exportMode === 'json') {
      const result = await window.electronAPI.exportJSON(ids);
      if (result.ok) alert(`备份成功！\n共 ${result.count} 条便签`);
      else if (result.error) alert('备份失败：' + result.error);
    } else {
      const result = await window.electronAPI.exportMarkdown(ids);
      if (result.ok) alert(`导出成功！\n共 ${result.count} 条便签`);
      else if (result.error) alert('导出失败：' + result.error);
    }
  });

  exportCancel.addEventListener('click', hideExportPanel);
  exportPanelClose.addEventListener('click', hideExportPanel);
  exportOverlay.addEventListener('click', (e) => { if (e.target === exportOverlay) hideExportPanel(); });

  document.getElementById('menu-export-json').addEventListener('click', () => {
    moreMenu.classList.remove('visible');
    showExportPanel('json');
  });

  document.getElementById('menu-export-md').addEventListener('click', () => {
    moreMenu.classList.remove('visible');
    showExportPanel('markdown');
  });

  document.getElementById('menu-import-json').addEventListener('click', async () => {
    moreMenu.classList.remove('visible');
    const result = await window.electronAPI.importJSON();
    if (result.ok) {
      alert(`恢复成功！\n文件中共 ${result.total} 条便签\n新增 ${result.added} 条，跳过 ${result.skipped} 条重复`);
      await state.init();
      notes.forceRender();
    } else if (result.error) {
      alert('恢复失败：' + result.error);
    }
  });

  // ---- 全局快捷键 ----
  document.addEventListener('keydown', async (e) => {
    // Ctrl+F → 聚焦搜索
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      openSearch();
      return;
    }
    // Ctrl+N → 新建普通便签
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      const note = await state.addNote('normal');
      sidebar.setActive('normal');
      return;
    }
    // Esc → 关闭弹窗（优先级：搜索 > 添加弹窗）
    if (e.key === 'Escape') {
      if (searchWrap.classList.contains('title-bar__search-wrap--open')) {
        closeSearch();
      } else if (addPopup.classList.contains('visible')) {
        addPopup.classList.remove('visible');
      }
    }
  });
}
