document.addEventListener('DOMContentLoaded', async () => {
  await state.init();
  sidebar.init();
  notes.init();
  initTitleBar();

  // 贴边把手管理
  const handles = document.getElementById('snap-handles');

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

  function updateHandleCounts() {
    const counts = { daily: 0, weekly: 0, normal: 0, timeline: 0 };
    state.getNotes().forEach(n => {
      if (n.type === 'timeline') counts.timeline++;
      const effective = getEffectiveType(n);
      if (effective !== 'timeline') counts[effective]++;
      else if (n.type !== 'timeline') counts[n.type]++;
    });
    ['daily', 'weekly', 'normal', 'timeline'].forEach(type => {
      const el = document.querySelector(`.snap-handle__count--${type}`);
      if (el) el.textContent = counts[type] || '';
    });
  }
});
