const sync = (() => {
  let status = { state: 'idle' };
  let timerInterval = null;
  let dropdownVisible = false;
  let userClosed = false; // 用户手动关闭面板后设为 true，阻止被动状态重新打开面板

  function init() {
    // 确保下拉面板初始隐藏
    const dropdown = document.getElementById('sync-dropdown');
    if (dropdown) dropdown.style.display = 'none';

    window.electronAPI.onSyncStatusChanged((newStatus) => {
      // 用户手动关闭面板后，忽略被动状态更新（idle + disconnected/timeout）
      const isActive = newStatus.state === 'pairing' || newStatus.state === 'discovering'
        || newStatus.state === 'connecting' || newStatus.state === 'connected';
      if (userClosed && !isActive) return;
      if (isActive) userClosed = false;
      status = newStatus;
      render();
    });

    window.electronAPI.onSyncDataChanged(() => {
      state.init().then(() => notes.forceRender());
    });

    window.electronAPI.getSyncStatus().then((s) => {
      status = s;
      render();
    }).catch(() => {
      render();
    });
  }

  function render() {
    const btn = document.getElementById('btn-sync');
    const dropdown = document.getElementById('sync-dropdown');
    if (!btn || !dropdown) return;

    // ---- 1. 更新按钮外观 ----
    btn.classList.remove('connected', 'spinning');
    if (status.state === 'connected') {
      btn.classList.add('connected');
      btn.title = `已同步 (${status.peerName || '另一台设备'})`;
    } else if (status.state === 'pairing' || status.state === 'discovering' || status.state === 'connecting') {
      btn.classList.add('spinning');
      btn.title = '同步中...';
    } else {
      btn.title = '同步';
    }

    // ---- 2. 决定面板是否可见 ----
    // 用户主动打开 或 正在进行同步操作 → 显示面板
    const shouldShow = dropdownVisible
      || status.state === 'pairing'
      || status.state === 'discovering'
      || status.state === 'connecting'
      || status.state === 'connected'
      || status.state === 'error';

    if (!shouldShow) {
      dropdown.style.display = 'none';
      dropdown.classList.remove('sync-dropdown--visible');
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      return;
    }

    // ---- 3. 显示面板 ----
    dropdown.classList.add('sync-dropdown--visible');
    dropdown.style.display = 'block';

    // 隐藏所有子面板
    const panels = ['sync-landing', 'sync-pairing', 'sync-join', 'sync-connecting', 'sync-connected', 'sync-error'];
    panels.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // ---- 4. 根据状态显示对应子面板 ----
    if (status.state === 'pairing') {
      document.getElementById('sync-pairing').style.display = 'block';
      document.getElementById('sync-code').textContent = status.code || '----';
      const infoEl = document.getElementById('sync-server-info');
      if (infoEl && status.serverIP) {
        infoEl.textContent = '服务器: ' + status.serverIP + ':' + (status.serverPort || 48484);
      }
      startTimer(status.expiresAt);

    } else if (status.state === 'discovering' || status.state === 'connecting') {
      document.getElementById('sync-connecting').style.display = 'block';

    } else if (status.state === 'connected') {
      document.getElementById('sync-connected').style.display = 'block';
      document.getElementById('sync-peer-name').textContent = status.peerName || '另一台设备';
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    } else if (status.state === 'error') {
      document.getElementById('sync-error').style.display = 'block';
      document.getElementById('sync-error-msg').textContent = status.error || '未知错误';
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    } else if (status.timeout) {
      document.getElementById('sync-error').style.display = 'block';
      document.getElementById('sync-error-msg').textContent = '配对超时，请重试';
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    } else if (status.disconnected) {
      document.getElementById('sync-error').style.display = 'block';
      document.getElementById('sync-error-msg').textContent = '连接已断开';
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    } else if (dropdownVisible) {
      // idle 但用户打开了面板 → 显示落地页
      document.getElementById('sync-landing').style.display = 'block';
    }
  }

  function startTimer(expiresAt) {
    if (timerInterval) clearInterval(timerInterval);
    updateTimerDisplay(expiresAt);
    timerInterval = setInterval(() => updateTimerDisplay(expiresAt), 1000);
  }

  function updateTimerDisplay(expiresAt) {
    const el = document.getElementById('sync-timer');
    if (!el) return;
    const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    el.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  }

  // ---- Show/hide dropdown ----

  function toggleDropdown() {
    userClosed = false;
    dropdownVisible = !dropdownVisible;
    render();
  }

  function closeDropdown() {
    dropdownVisible = false;
    userClosed = true;
    if (status.state === 'pairing' || status.state === 'discovering' || status.state === 'connecting') {
      window.electronAPI.cancelPairing();
    }
    // 清除临时状态，下次打开时回到落地页
    status = { state: status.state };
    const dropdown = document.getElementById('sync-dropdown');
    if (dropdown) {
      dropdown.classList.remove('sync-dropdown--visible');
      dropdown.style.display = 'none';
    }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  // ---- Pairing actions ----

  function switchToPairing() {
    status.timeout = false;
    status.disconnected = false;
    status.error = null;
    dropdownVisible = true;
    window.electronAPI.startPairing().then((result) => {
      if (!result) render();
    });
  }

  function switchToJoin() {
    status.timeout = false;
    status.disconnected = false;
    status.error = null;
    dropdownVisible = true;
    document.getElementById('sync-landing').style.display = 'none';
    document.getElementById('sync-join').style.display = 'block';
    document.getElementById('sync-pairing').style.display = 'none';
    document.getElementById('sync-connected').style.display = 'none';
    document.getElementById('sync-connecting').style.display = 'none';
    document.getElementById('sync-error').style.display = 'none';
    document.getElementById('sync-dropdown').classList.add('sync-dropdown--visible');
    document.getElementById('sync-dropdown').style.display = 'block';
    const digits = document.querySelectorAll('#sync-code-inputs input');
    digits.forEach(d => d.value = '');
    digits[0].focus();
    document.getElementById('sync-connect-btn').disabled = true;
  }

  function handleConnect() {
    const digits = document.querySelectorAll('#sync-code-inputs input');
    let code = '';
    digits.forEach(d => code += d.value);
    if (code.length !== 6) return;
    const ipInput = document.getElementById('sync-ip-input');
    const manualIP = ipInput ? ipInput.value.trim() : '';
    document.getElementById('sync-join').style.display = 'none';
    document.getElementById('sync-connecting').style.display = 'block';
    if (manualIP) {
      window.electronAPI.connectWithIP(manualIP, 48484, code);
    } else {
      window.electronAPI.joinWithCode(code);
    }
  }

  function handleDisconnect() {
    window.electronAPI.disconnect();
  }

  function handleCancelPairing() {
    window.electronAPI.cancelPairing();
    dropdownVisible = false;
    const dropdown = document.getElementById('sync-dropdown');
    if (dropdown) {
      dropdown.classList.remove('sync-dropdown--visible');
      dropdown.style.display = 'none';
    }
  }

  // ---- Event handlers ----

  function setupEventHandlers() {
    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) {
      syncBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
      });
    }

    // 点击面板外部关闭
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('sync-dropdown');
      const btn = document.getElementById('btn-sync');
      if (dropdownVisible && dropdown && !dropdown.contains(e.target) && !btn?.contains(e.target)) {
        closeDropdown();
      }
    });

    document.getElementById('sync-start-btn')?.addEventListener('click', switchToPairing);
    document.getElementById('sync-join-btn')?.addEventListener('click', switchToJoin);
    document.getElementById('sync-switch-join')?.addEventListener('click', switchToJoin);
    document.getElementById('sync-cancel-pairing')?.addEventListener('click', handleCancelPairing);
    document.getElementById('sync-cancel-connecting')?.addEventListener('click', handleCancelPairing);
    document.getElementById('sync-error-close')?.addEventListener('click', () => {
      window.electronAPI.cancelPairing();
      closeDropdown();
    });
    document.getElementById('sync-connect-btn')?.addEventListener('click', handleConnect);
    document.getElementById('sync-disconnect-btn')?.addEventListener('click', handleDisconnect);
    document.getElementById('sync-cancel-join')?.addEventListener('click', closeDropdown);

    // 配对码输入
    document.querySelectorAll('#sync-code-inputs input').forEach(input => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val;
        if (val && e.target.dataset.index < '5') {
          const next = document.querySelector(`#sync-code-inputs input[data-index="${parseInt(e.target.dataset.index) + 1}"]`);
          if (next) next.focus();
        }
        updateConnectButton();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && e.target.dataset.index > '0') {
          const prev = document.querySelector(`#sync-code-inputs input[data-index="${parseInt(e.target.dataset.index) - 1}"]`);
          if (prev) { prev.focus(); prev.value = ''; }
          updateConnectButton();
        }
        if (e.key === 'Enter') handleConnect();
      });
    });
  }

  function updateConnectButton() {
    const digits = document.querySelectorAll('#sync-code-inputs input');
    let full = true;
    digits.forEach(d => { if (!d.value) full = false; });
    document.getElementById('sync-connect-btn').disabled = !full;
  }

  return { init, setupEventHandlers };
})();
