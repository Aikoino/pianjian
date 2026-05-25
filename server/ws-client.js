const WebSocket = require('ws');
const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function connect(ip, port, code, onMessage, onConnected, onDisconnected, onError, deviceName, deviceId) {
  const token = sha256(code);
  let ws = null;
  let closed = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;

  function cleanup() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function doConnect() {
    if (closed) return;

    try {
      ws = new WebSocket(`ws://${ip}:${port}`);
    } catch (e) {
      if (onError) onError('连接失败: ' + e.message);
      if (onDisconnected) onDisconnected();
      return;
    }

    let authed = false;
    let authTimer = null;
    let connectFailed = true;

    // Connection timeout (15s total)
    const connectTimeout = setTimeout(() => {
      if (connectFailed) {
        try { ws.close(); } catch (e) {}
        if (onError) onError('连接超时，请确认两台设备在同一网络');
        if (onDisconnected) onDisconnected();
      }
    }, 15000);

    authTimer = setTimeout(() => {
      if (!authed) {
        try { ws.close(); } catch (e) {}
        if (onError) onError('认证超时');
        if (onDisconnected) onDisconnected();
      }
    }, 10000);

    ws.on('open', () => {
      connectFailed = false;
      clearTimeout(connectTimeout);
      clearTimeout(authTimer);
      ws.send(JSON.stringify({ type: 'auth', token, deviceName, deviceId }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString('utf-8'));

        if (!authed) {
          if (msg.type === 'auth_ok') {
            authed = true;
            clearTimeout(authTimer);
            reconnectAttempts = 0;
            console.log('[sync] WS 客户端认证成功');
            if (onConnected) onConnected();
          } else if (msg.type === 'auth_fail') {
            clearTimeout(authTimer);
            if (onError) onError(msg.reason || '配对码验证失败');
            try { ws.close(); } catch (e) {}
            if (onDisconnected) onDisconnected();
          }
          return;
        }

        if (msg.type === 'sync_full' || msg.type === 'note_add' ||
            msg.type === 'note_update' || msg.type === 'note_delete') {
          if (onMessage) onMessage(msg);
        } else if (msg.type === 'heartbeat_ack') {
          // keepalive acknowledged
        }
      } catch (e) {
        // ignore
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      clearTimeout(connectTimeout);
      if (authed) {
        // Unexpected disconnect, try reconnect
        if (!closed && reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          reconnectTimer = setTimeout(doConnect, delay);
        } else {
          if (onDisconnected) onDisconnected();
        }
      }
    });

    ws.on('error', (e) => {
      if (!authed && connectFailed) {
        connectFailed = false;
        clearTimeout(authTimer);
        if (onError) onError('连接失败: ' + (e.message || '网络错误'));
        if (onDisconnected) onDisconnected();
      }
    });
  }

  doConnect();

  function disconnect() {
    closed = true;
    cleanup();
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }
  }

  function send(msg) {
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(msg));
      } catch (e) {
        // ignore
      }
    }
  }

  return { disconnect, send };
}

module.exports = { connect };
