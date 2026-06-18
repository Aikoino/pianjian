// UUID v4 生成（使用密码学安全随机数）
function uuid() {
  return crypto.randomUUID();
}

// 防抖
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// timeline 条目自动晋升
// 日期 = 今天 → daily；日期 = 本周 → weekly；否则保持 timeline
function getEffectiveType(note) {
  if (note.type !== 'timeline' || !note.customDate) return note.type;

  const today = new Date();
  // 使用本地时区日期（避免 toISOString() 返回 UTC 导致 off-by-one）
  const todayStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  if (note.customDate === todayStr) return 'daily';

  const custom = new Date(note.customDate + 'T00:00:00');
  const dow = today.getDay(); // 0=周日
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  if (custom >= monday && custom <= sunday) return 'weekly';
  return 'timeline';
}

// 统计各类便签数量（含回收站）
function computeNoteCounts(notes) {
  const counts = { all: 0, daily: 0, weekly: 0, normal: 0, timeline: 0, trash: 0 };
  notes.forEach(n => {
    if (n.deletedAt) { counts.trash++; return; }
    counts.all++; // 全部 = 非删除便签总数
    const effective = getEffectiveType(n);
    if (counts[effective] !== undefined) counts[effective]++;
  });
  return counts;
}

// 提醒快捷预设管理面板
function showPresetManager(parentPopup) {
  // 移除已有的管理面板
  document.querySelectorAll('.preset-manager').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'preset-manager';
  overlay.innerHTML = `
    <div class="preset-manager__panel">
      <div class="preset-manager__header">
        <span class="preset-manager__title">管理快捷选项</span>
        <button class="preset-manager__close">&times;</button>
      </div>
      <div class="preset-manager__list" id="preset-list"></div>
      <div class="preset-manager__add">
        <select id="preset-type">
          <option value="minutes">分钟后</option>
          <option value="hours">小时后</option>
          <option value="tomorrow">明天</option>
          <option value="nextWeekday">下周几</option>
        </select>
        <input id="preset-value" type="number" min="1" max="999" value="10" style="width:50px">
        <select id="preset-weekday" style="display:none">
          <option value="1">周一</option>
          <option value="2">周二</option>
          <option value="3">周三</option>
          <option value="4">周四</option>
          <option value="5">周五</option>
          <option value="6">周六</option>
          <option value="0">周日</option>
        </select>
        <input id="preset-label" type="text" placeholder="名称" style="width:70px">
        <button id="preset-add-btn">添加</button>
      </div>
      <div class="preset-manager__footer">
        <button id="preset-reset">恢复默认</button>
        <button id="preset-save">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const DEFAULTS = [
    { label: '5 分钟', type: 'minutes', value: 5 },
    { label: '30 分钟', type: 'minutes', value: 30 },
    { label: '1 小时', type: 'hours', value: 1 },
    { label: '明天 9:00', type: 'tomorrow', hour: 9 },
    { label: '下周一 9:00', type: 'nextWeekday', weekday: 1, hour: 9 },
  ];

  let currentPresets = [];

  function renderList() {
    const list = overlay.querySelector('#preset-list');
    list.innerHTML = '';
    currentPresets.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'preset-manager__item';
      const desc = describePreset(p);
      item.innerHTML = `<span class="preset-manager__item-label">${p.label}</span><span class="preset-manager__item-desc">${desc}</span>`;
      const delBtn = document.createElement('button');
      delBtn.className = 'preset-manager__item-del';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        currentPresets.splice(i, 1);
        renderList();
      });
      item.appendChild(delBtn);
      list.appendChild(item);
    });
  }

  function describePreset(p) {
    switch (p.type) {
      case 'minutes': return `${p.value} 分钟后`;
      case 'hours': return `${p.value} 小时后`;
      case 'tomorrow': return `明天 ${String(p.hour||9).padStart(2,'0')}:${String(p.minute||0).padStart(2,'0')}`;
      case 'nextWeekday': {
        const days = ['周日','周一','周二','周三','周四','周五','周六'];
        return `下周${days[p.weekday ?? 1]} ${String(p.hour||9).padStart(2,'0')}:${String(p.minute||0).padStart(2,'0')}`;
      }
      default: return '';
    }
  }

  // 加载当前预设
  window.electronAPI.getReminderPresets().then(presets => {
    currentPresets = JSON.parse(JSON.stringify(presets));
    renderList();
  });

  // 类型切换时更新输入框
  const typeSelect = overlay.querySelector('#preset-type');
  const valueInput = overlay.querySelector('#preset-value');
  const labelInput = overlay.querySelector('#preset-label');
  const weekdaySelect = overlay.querySelector('#preset-weekday');

  typeSelect.addEventListener('change', () => {
    const t = typeSelect.value;
    weekdaySelect.style.display = t === 'nextWeekday' ? '' : 'none';
    // 先清空再改 type，避免格式校验报错
    valueInput.value = '';
    if (t === 'tomorrow' || t === 'nextWeekday') {
      valueInput.type = 'time';
      valueInput.value = '09:00';
      valueInput.style.width = '80px';
    } else {
      valueInput.type = 'number';
      valueInput.min = '1';
      valueInput.max = '999';
      valueInput.value = t === 'hours' ? '1' : '10';
      valueInput.style.width = '50px';
    }
  });

  // 添加按钮
  overlay.querySelector('#preset-add-btn').addEventListener('click', () => {
    const type = typeSelect.value;
    let preset = { label: labelInput.value || '', type };
    if (type === 'minutes') {
      preset.value = parseInt(valueInput.value) || 10;
      if (!preset.label) preset.label = `${preset.value} 分钟`;
    } else if (type === 'hours') {
      preset.value = parseInt(valueInput.value) || 1;
      if (!preset.label) preset.label = `${preset.value} 小时`;
    } else if (type === 'tomorrow') {
      const [h, m] = (valueInput.value || '09:00').split(':').map(Number);
      preset.hour = h; preset.minute = m;
      if (!preset.label) preset.label = `明天 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    } else if (type === 'nextWeekday') {
      const [h, m] = (valueInput.value || '09:00').split(':').map(Number);
      preset.weekday = parseInt(weekdaySelect.value);
      preset.hour = h; preset.minute = m;
      const days = ['周日','周一','周二','周三','周四','周五','周六'];
      if (!preset.label) preset.label = `下周${days[preset.weekday]} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    currentPresets.push(preset);
    renderList();
    labelInput.value = '';
  });

  // 恢复默认
  overlay.querySelector('#preset-reset').addEventListener('click', () => {
    currentPresets = JSON.parse(JSON.stringify(DEFAULTS));
    renderList();
  });

  // 保存
  overlay.querySelector('#preset-save').addEventListener('click', async () => {
    console.log('[presets] 保存:', JSON.stringify(currentPresets));
    await window.electronAPI.setReminderPresets(currentPresets);
    overlay.remove();
    // 通知所有提醒弹窗刷新快捷按钮
    document.querySelectorAll('.note-card__reminder-quick').forEach(row => {
      row.dispatchEvent(new Event('presetsUpdated'));
    });
  });

  // 关闭
  overlay.querySelector('.preset-manager__close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}
