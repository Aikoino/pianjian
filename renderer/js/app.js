document.addEventListener('DOMContentLoaded', async () => {
  // 初始化主题
  const savedTheme = await window.electronAPI.getTheme(); // 'light' | 'dark' | 'system'

  function applyTheme(theme) {
    let useDark = false;
    if (theme === 'dark') useDark = true;
    else if (theme === 'system') useDark = window.__systemDark || false;
    if (useDark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }

  // 获取系统主题并应用
  if (savedTheme === 'system') {
    window.__systemDark = await window.electronAPI.getSystemDark();
  }
  applyTheme(savedTheme);

  // 监听系统主题变化
  window.electronAPI.onSystemThemeChanged((isDark) => {
    window.__systemDark = isDark;
    if ((savedTheme === 'system') || (window.__currentTheme === 'system')) {
      applyTheme('system');
    }
  });

  window.__currentTheme = savedTheme;

  // 主题切换按钮
  const themeBtn = document.getElementById('btn-theme');
  const THEME_ORDER = ['light', 'dark', 'system'];
  const THEME_ICONS = {
    light: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    dark: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    system: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  };
  const THEME_TITLES = { light: '浅色模式（点击切换）', dark: '深色模式（点击切换）', system: '跟随系统（点击切换）' };

  function updateThemeBtn() {
    const t = window.__currentTheme;
    themeBtn.innerHTML = THEME_ICONS[t] || THEME_ICONS.light;
    themeBtn.title = THEME_TITLES[t] || '';
  }
  updateThemeBtn();

  themeBtn.addEventListener('click', async () => {
    const idx = THEME_ORDER.indexOf(window.__currentTheme);
    const nextTheme = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    window.__currentTheme = nextTheme;
    applyTheme(nextTheme);
    updateThemeBtn();
    await window.electronAPI.setTheme(nextTheme);
  });

  await state.init();
  state.purgeOldNotes(); // 自动清理 30 天前的回收站便签
  sidebar.init();
  notes.init();
  initTitleBar();
  sync.init();
  sync.setupEventHandlers();

  // 贴边把手管理
  const handles = document.getElementById('snap-handles');

  // 把手点击切换分类
  handles.querySelectorAll('.snap-handle').forEach(handle => {
    handle.addEventListener('click', () => {
      const type = handle.dataset.type;
      if (type) sidebar.setActive(type);
    });
  });

  window.electronAPI.onSnapChanged(({ snapped, edge, showing }) => {
    if (snapped && !showing) {
      // 贴边隐藏中：只显示书签把手，隐藏主界面
      document.body.classList.add('is-snapped');
      handles.classList.add('snap-handles--visible');
      handles.classList.remove('snap-handles--left', 'snap-handles--right');
      handles.classList.add(edge === 'right' ? 'snap-handles--left' : 'snap-handles--right');
      updateHandleCounts();
    } else {
      // 正常状态或贴边展开：显示完整界面
      document.body.classList.remove('is-snapped');
      handles.classList.remove('snap-handles--visible');
    }
  });

  state.onChange(() => updateHandleCounts());

  // ---- 自由 resize 手柄 ----
  const resizeHandle = document.getElementById('resize-handle');
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    window.electronAPI.startResize();
  });
  document.addEventListener('mouseup', () => {
    window.electronAPI.endResize();
  });

  // ---- 应用更新检查 ----
  const banner = document.getElementById('update-banner');
  const updateText = document.getElementById('update-text');
  const btnDownload = document.getElementById('btn-update-download');
  const btnClose = document.getElementById('btn-update-close');

  // 监听主进程推送的更新通知
  window.electronAPI.onUpdateAvailable((info) => {
    if (info.hasUpdate) {
      updateText.textContent = `发现新版本 v${info.latestVersion}（当前 v${info.currentVersion}）`;
      btnDownload.onclick = () => {
        window.electronAPI.openExternal(info.downloadUrl);
      };
      banner.style.display = 'flex';
    }
  });

  btnClose.onclick = () => {
    banner.style.display = 'none';
  };

  function updateHandleCounts() {
    const counts = computeNoteCounts(state.getNotes());
    ['daily', 'weekly', 'normal', 'timeline'].forEach(type => {
      const el = document.querySelector(`.snap-handle__count--${type}`);
      if (el) el.textContent = counts[type] || '';
    });
  }
});
