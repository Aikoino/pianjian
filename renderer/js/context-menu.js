// 右键菜单模块
const contextMenu = (() => {
  let menuEl = null;

  function create() {
    menuEl = document.createElement('div');
    menuEl.className = 'context-menu';
    document.body.appendChild(menuEl);

    // 点击任意位置关闭
    document.addEventListener('click', hide);
    // 滚动时关闭
    document.addEventListener('scroll', hide, true);
    // 窗口大小变化时关闭
    window.addEventListener('resize', hide);
  }

  /**
   * 显示右键菜单
   * @param {number} x - 鼠标 X 坐标
   * @param {number} y - 鼠标 Y 坐标
   * @param {Array} items - 菜单项数组
   *   每项: { label, icon?, action, danger? } 或 { sep: true }
   */
  function show(x, y, items) {
    if (!menuEl) create();
    menuEl.innerHTML = '';

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'context-menu__sep';
        menuEl.appendChild(sep);
        return;
      }
      const btn = document.createElement('div');
      btn.className = 'context-menu__item' + (item.danger ? ' context-menu__item--danger' : '');
      btn.textContent = (item.icon ? item.icon + ' ' : '') + item.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        hide();
        if (item.action) item.action();
      });
      menuEl.appendChild(btn);
    });

    // 定位（边界检测）
    menuEl.style.left = '0px';
    menuEl.style.top = '0px';
    menuEl.classList.add('visible');

    const rect = menuEl.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let left = x;
    let top = y;
    if (x + rect.width > winW) left = winW - rect.width - 4;
    if (y + rect.height > winH) top = winH - rect.height - 4;
    if (left < 0) left = 4;
    if (top < 0) top = 4;

    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';
  }

  function hide() {
    if (menuEl) menuEl.classList.remove('visible');
  }

  return { create, show, hide };
})();
