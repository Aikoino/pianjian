import { sha256 } from '../utils/crypto';
import { log } from '../utils/logger';

const MAX_RECONNECT = 10;

export function connect(ip, port, code, onMessage, onConnected, onDisconnected, onError, deviceName, deviceId) {
  let ws = null;
  let closed = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  // 使用可变引用，onFound 回调可以更新端口号
  const conn = { ip, port };

  function cleanup() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  async function doConnect() {
    if (closed) return;

    try {
      const token = await sha256(code);
      log('WS-客户端', `连接 ws://${conn.ip}:${conn.port} token=${token.slice(0, 8)}...`);

      ws = new WebSocket(`ws://${conn.ip}:${conn.port}`);
      let authed = false;
      let authTimer = null;
      let connectFailed = true;

      const connectTimeout = setTimeout(() => {
        if (connectFailed) {
          log('WS-客户端', `连接超时 (15s)`);
          try { ws.close(); } catch (e) {}
        }
      }, 15000);

      authTimer = setTimeout(() => {
        if (!authed) {
          log('WS-客户端', `认证超时 (10s)`);
          try { ws.close(); } catch (e) {}
        }
      }, 10000);

      ws.onopen = () => {
        connectFailed = false;
        clearTimeout(connectTimeout);
        log('WS-客户端', `连接已建立，发送 auth...`);
        ws.send(JSON.stringify({ type: 'auth', token, deviceName, deviceId }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          log('WS-客户端', `收到: ${msg.type}`);
          if (!authed) {
            if (msg.type === 'auth_ok') {
              authed = true;
              clearTimeout(authTimer);
              reconnectAttempts = 0;
              log('WS-客户端', `认证成功!`);
              if (onConnected) onConnected();
            } else if (msg.type === 'auth_fail') {
              clearTimeout(authTimer);
              log('WS-客户端', `认证失败: ${msg.reason}`);
              if (onError) onError(msg.reason || '配对码验证失败');
              try { ws.close(); } catch (e) {}
            }
            return;
          }
          if (msg.type === 'sync_full' || msg.type === 'note_add' ||
              msg.type === 'note_update' || msg.type === 'note_delete') {
            if (onMessage) onMessage(msg);
          }
        } catch (e) {
          log('WS-客户端', `消息解析异常: ${e.message}`);
        }
      };

      ws.onclose = (event) => {
        clearTimeout(authTimer);
        log('WS-客户端', `连接关闭 code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`);
        if (!closed && reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          log('WS-客户端', `${delay / 1000}s 后重连 (${reconnectAttempts}/${MAX_RECONNECT})`);
          reconnectTimer = setTimeout(doConnect, delay);
        } else {
          if (onDisconnected) onDisconnected();
        }
      };

      ws.onerror = (event) => {
        log('WS-客户端', `错误: ${event.message || '未知错误'}`);
      };
    } catch (e) {
      log('WS-客户端', `异常: ${e.message}`);
      if (onError) onError('连接失败: ' + e.message);
      if (onDisconnected) onDisconnected();
    }
  }

  doConnect();

  function disconnect() {
    closed = true;
    cleanup();
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  }

  function send(msg) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(msg)); } catch (e) {}
    }
  }

  // 暴露 conn 引用，允许 discovery 回调更新端口
  return { disconnect, send, conn };
}
