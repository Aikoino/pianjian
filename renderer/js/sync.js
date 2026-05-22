const sync = (() => {
  let status = { state: 'idle' };
  let timerInterval = null;
  let showingLanding = false;

  function init() {
    // Listen for status changes from main process
    window.electronAPI.onSyncStatusChanged((newStatus) => {
      status = newStatus;
      render();
    });

    // Listen for remote data changes → refresh notes
    window.electronAPI.onSyncDataChanged(() => {
      // Re-init state from storage
      state.init();
    });

    // Get initial status
    window.electronAPI.getSyncStatus().then((s) => {
      status = s;
      // Don't close landing panel if user is already interacting
      if (!showingLanding) render();
    });
  }

  function render() {
    const btn = document.getElementById('btn-sync');
    if (!btn) return;

    // Update button state
    if (status.status === 'connected') {
      btn.classList.add('connected');
      btn.title = `已同步 (${status.peerName || '另一台设备'})`;
    } else {
      btn.classList.remove('connected');
      btn.title = '同步';
    }

    // Show/hide dialog based on state
    const dialog = document.getElementById('sync-dialog');
    if (!dialog) return;

    // Don't auto-close if showing the landing/mode-choice panel
    if (status.status === 'idle' && !status.timeout && !status.disconnected && !status.error) {
      if (showingLanding) return;
      dialog.classList.remove('sync-dialog--visible');
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      return;
    }

    showingLanding = false;
    dialog.classList.add('sync-dialog--visible');

    // Show appropriate panel
    const landingPanel = document.getElementById('sync-landing');
    const pairingPanel = document.getElementById('sync-pairing');
    const joinPanel = document.getElementById('sync-join');
    const connectingPanel = document.getElementById('sync-connecting');
    const connectedPanel = document.getElementById('sync-connected');
    const errorPanel = document.getElementById('sync-error');

    // Hide all first
    [landingPanel, pairingPanel, joinPanel, connectingPanel, connectedPanel, errorPanel].forEach(p => {
      if (p) p.style.display = 'none';
    });

    switch (status.status) {
      case 'pairing':
        pairingPanel.style.display = 'block';
        document.getElementById('sync-code').textContent = status.code || '----';
        startTimer(status.expiresAt);
        break;

      case 'discovering':
      case 'connecting':
        connectingPanel.style.display = 'block';
        break;

      case 'connected':
        connectedPanel.style.display = 'block';
        document.getElementById('sync-peer-name').textContent = status.peerName || '另一台设备';
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        break;

      case 'error':
        errorPanel.style.display = 'block';
        document.getElementById('sync-error-msg').textContent = status.error || '发生未知错误';
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        break;
    }

    if (status.timeout) {
      errorPanel.style.display = 'block';
      document.getElementById('sync-error-msg').textContent = '配对超时（2 分钟已到），请重试';
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }

    if (status.disconnected) {
      errorPanel.style.display = 'block';
      document.getElementById('sync-error-msg').textContent = '连接已断开';
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
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
    const min = String(Math.floor(remaining / 60)).padStart(2, '0');
    const sec = String(remaining % 60).padStart(2, '0');
    el.textContent = `${min}:${sec}`;
    el.classList.toggle('sync-dialog__timer--warning', remaining <= 30);
  }

  // ---- Dialog management ----

  function showDialog() {
    if (status.status === 'idle') {
      // Show mode-selection landing panel
      showingLanding = true;
      const dialog = document.getElementById('sync-dialog');
      dialog.classList.add('sync-dialog--visible');
      document.getElementById('sync-landing').style.display = 'block';
      document.getElementById('sync-pairing').style.display = 'none';
      document.getElementById('sync-join').style.display = 'none';
      document.getElementById('sync-connecting').style.display = 'none';
      document.getElementById('sync-connected').style.display = 'none';
      document.getElementById('sync-error').style.display = 'none';
    } else {
      render();
    }
  }

  function switchToPairing() {
    // Reset old status flags
    status.timeout = false;
    status.disconnected = false;
    status.error = null;

    showingLanding = false;

    // Hide all panels
    document.getElementById('sync-landing').style.display = 'none';
    document.getElementById('sync-pairing').style.display = 'block';
    document.getElementById('sync-join').style.display = 'none';
    document.getElementById('sync-connected').style.display = 'none';
    document.getElementById('sync-connecting').style.display = 'none';
    document.getElementById('sync-error').style.display = 'none';

    window.electronAPI.startPairing().then((result) => {
      if (!result) {
        render();
      }
    });
  }

  function switchToJoin() {
    // Reset old status flags
    status.timeout = false;
    status.disconnected = false;
    status.error = null;

    showingLanding = false;

    // Hide all panels
    document.getElementById('sync-landing').style.display = 'none';
    document.getElementById('sync-pairing').style.display = 'none';
    document.getElementById('sync-join').style.display = 'block';
    document.getElementById('sync-connected').style.display = 'none';
    document.getElementById('sync-connecting').style.display = 'none';
    document.getElementById('sync-error').style.display = 'none';

    // Reset code inputs
    const digits = document.querySelectorAll('.sync-dialog__digit');
    digits.forEach(d => d.value = '');
    digits[0].focus();
    document.getElementById('sync-connect-btn').disabled = true;
  }

  function hideDialog() {
    showingLanding = false;
    if (status.status === 'pairing' || status.status === 'discovering') {
      window.electronAPI.cancelPairing();
    }
    document.getElementById('sync-dialog').classList.remove('sync-dialog--visible');
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function handleConnect() {
    const digits = document.querySelectorAll('.sync-dialog__digit');
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

  // ---- Setup event handlers (called from init) ----

  function setupEventHandlers() {
    // Landing panel: choose mode
    document.getElementById('sync-start-btn')?.addEventListener('click', switchToPairing);
    document.getElementById('sync-join-btn')?.addEventListener('click', switchToJoin);

    // Switch between pairing and join
    document.getElementById('sync-switch-join')?.addEventListener('click', switchToJoin);
    document.getElementById('sync-switch-start')?.addEventListener('click', switchToPairing);

    // Cancel buttons
    document.querySelectorAll('.sync-dialog__btn--cancel').forEach(btn => {
      btn.addEventListener('click', hideDialog);
    });

    // Error close buttons
    document.querySelectorAll('.sync-dialog__btn--error-close').forEach(btn => {
      btn.addEventListener('click', hideDialog);
    });

    // Connect button
    document.getElementById('sync-connect-btn')?.addEventListener('click', handleConnect);

    // Code digit inputs
    document.querySelectorAll('.sync-dialog__digit').forEach(input => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val;
        if (val && e.target.dataset.index < '5') {
          const next = document.querySelector(`.sync-dialog__digit[data-index="${parseInt(e.target.dataset.index) + 1}"]`);
          if (next) next.focus();
        }
        updateConnectButton();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && e.target.dataset.index > '0') {
          const prev = document.querySelector(`.sync-dialog__digit[data-index="${parseInt(e.target.dataset.index) - 1}"]`);
          if (prev) { prev.focus(); prev.value = ''; }
          updateConnectButton();
        }
        if (e.key === 'Enter') {
          handleConnect();
        }
      });

      input.addEventListener('focus', () => input.select());
    });

    // Disconnect button
    document.getElementById('sync-disconnect-btn')?.addEventListener('click', handleDisconnect);

    // Click overlay to close (only when idle-type states)
    document.getElementById('sync-dialog-overlay')?.addEventListener('click', () => {
      if (status.status === 'error' || status.timeout || status.disconnected) {
        hideDialog();
      }
    });
  }

  function updateConnectButton() {
    const digits = document.querySelectorAll('.sync-dialog__digit');
    let full = true;
    digits.forEach(d => { if (!d.value) full = false; });
    document.getElementById('sync-connect-btn').disabled = !full;
  }

  return { init, showDialog, hideDialog, setupEventHandlers };
})();
