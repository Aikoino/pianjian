document.addEventListener('DOMContentLoaded', async () => {
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
