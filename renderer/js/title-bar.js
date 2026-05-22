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

  autoLaunchBtn.addEventListener('click', () => {
    const enabled = !autoLaunchBtn.classList.contains('active');
    // 乐观更新：先切换 UI，再异步写注册表
    autoLaunchBtn.classList.toggle('active', enabled);
    window.electronAPI.setAutoLaunch(enabled);
  });

  // 同步按钮
  const syncBtn = document.getElementById('btn-sync');
  syncBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sync.showDialog();
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
}
