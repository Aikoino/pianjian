const sync = (() => {
  let status = { state: 'idle' };
  let timerInterval = null;
  let dropdownVisible = false;

  function init() {
    window.electronAPI.onSyncStatusChanged((newStatus) => {
      status = newStatus;
      render();
    });

    window.electronAPI.onSyncDataChanged(() => {
      state.init();
    });

    window.electronAPI.getSyncStatus().then((s) => {
      status = s;
      render();
    });
  }

  function render() {
    const btn = document.getElementById('btn-sync');
    const dropdown = document.getElementById('sync-dropdown');
    if (!btn || !dropdown) return;

    // 按钮状态
    btn.classList.remove('connected', 'spinning');
    if (status.status === 'connected') {
      btn.classList.add('connected');
      btn.title = `已同步 (${status.peerName || '另一台设备'})`;
    } else if (status.status === 'pairing' || status.status === 'discovering' || status.status === 'connecting') {
      btn.classList.add('spinning');
      btn.title = '同步中...';
    } else {
      btn.title = '同步';
    }

    if (!dropdownVisible && status.status === 'idle' && !status.timeout && !status.disconnected && !status.error) {
      dropdown.classList.remove('sync-dropdown--visible');
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      return;
    }

    if (!dropdownVisible && status.status === 'idle') return;

    dropdown.classList.add('sync-dropdown--visible');

    // Hide all panels
    const panels = ['sync-landing', 'sync-pairing', 'sync-join', 'sync-connecting', 'sync-connected', 'sync-error'];
    panels.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    switch (status.status) {
      case 'pairing':
        document.getElementById('sync-pairing').style.display = 'block';
        document.getElementById('sync-code').textContent = status.code || '----';
        const infoEl = document.getElementById('sync-server-info');
        if (infoEl && status.serverIP) {
          infoEl.textContent = '服务器: ' + status.serverIP + ':' + (status.serverPort || 48484);
        }
        startTimer(status.expiresAt);
        break;

      case 'discovering':
      case 'connecting':
        document.getElementById('sync-connecting').style.display = 'block';
        break;

      case 'connected':
        document.getElementById('sync-connected').style.display = 'block';
        document.getElementById('sync-peer-name').textContent = status.peerName || '另一台设备';
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        break;

      case 'error':
        document.getElementById('sync-error').style.display = 'block';
        document.getElementById('sync-error-msg').textContent = status.error || '未知错误';
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        break;
    }

    if (status.timeout) {
      document.getElementById('sync-error').style.display = 'block';
      document.getElementById('sync-error-msg').textContent = '配对超时，请重试';
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }
    if (status.disconnected) {
      document.getElementById('sync-error').style.display = 'block';
      document.getElementById('sync-error-msg').textContent = '连接已断开';
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
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
    if (status.status !== 'idle') {
      // Already active, just toggle
      dropdownVisible = !dropdownVisible;
      render();
      return;
    }
    // Idle: show landing
    status = { ...status, status: 'idle' };
    dropdownVisible = true;
    render();
  }

  function closeDropdown() {
    dropdownVisible = false;
    if (status.status === 'pairing' || status.status === 'discovering' || status.status === 'connecting') {
      window.electronAPI.cancelPairing();
    }
    document.getElementById('sync-dropdown').classList.remove('sync-dropdown--visible');
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  // ---- Pairing actions ----

  function switchToPairing() {
    status.timeout = false;
    status.disconnected = false;
    status.error = null;
    dropdownVisible = true;
    render();
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
    document.getElementById('sync-join').style.display = 'none';
    document.getElementById('sync-connecting').style.display = 'block';
    window.electronAPI.joinWithCode(code);
  }

  function handleDisconnect() {
    window.electronAPI.disconnect();
  }

  function handleCancelPairing() {
    window.electronAPI.cancelPairing();
    dropdownVisible = false;
    document.getElementById('sync-dropdown').classList.remove('sync-dropdown--visible');
  }

  // ---- Event handlers ----

  function setupEventHandlers() {
    // Toggle dropdown on button click
    document.getElementById('btn-sync')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('sync-dropdown');
      const btn = document.getElementById('btn-sync');
      if (dropdownVisible && dropdown && !dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        closeDropdown();
      }
    });

    document.getElementById('sync-start-btn')?.addEventListener('click', switchToPairing);
    document.getElementById('sync-join-btn')?.addEventListener('click', switchToJoin);

    document.getElementById('sync-switch-join')?.addEventListener('click', switchToJoin);

    // Cancel buttons
    document.getElementById('sync-cancel-pairing')?.addEventListener('click', handleCancelPairing);
    document.querySelectorAll('.sync-dropdown__btn--danger').forEach(btn => {
      if (btn.id === 'sync-disconnect-btn') return;
      btn.addEventListener('click', () => {
        if (btn.id !== 'sync-cancel-pairing') closeDropdown();
      });
    });

    // Error close
    document.getElementById('sync-error-close')?.addEventListener('click', () => {
      window.electronAPI.cancelPairing();
      closeDropdown();
    });

    // Connect button
    document.getElementById('sync-connect-btn')?.addEventListener('click', handleConnect);

    // Digit inputs
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

    // Disconnect button
    document.getElementById('sync-disconnect-btn')?.addEventListener('click', handleDisconnect);
  }

  function updateConnectButton() {
    const digits = document.querySelectorAll('#sync-code-inputs input');
    let full = true;
    digits.forEach(d => { if (!d.value) full = false; });
    document.getElementById('sync-connect-btn').disabled = !full;
  }

  return { init, setupEventHandlers };
})();
