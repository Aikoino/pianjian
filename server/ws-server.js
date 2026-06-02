const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function createServer(code, onMessage, onPeerConnected, onPeerDisconnected, onError) {
  const targetToken = sha256(code);
  let wss = null;
  let client = null;
  let authTimer = null;
  let closed = false;
  let actualPort = 0;
  let httpServer = null;

  // 依次尝试 48484、48485，最后回退到随机端口
  const TRY_PORTS = [48484, 48485];
  for (const port of TRY_PORTS) {
    try {
      httpServer = http.createServer();
      await new Promise((resolve, reject) => {
        httpServer.once('error', (err) => reject(err));
        httpServer.once('listening', () => resolve());
        httpServer.listen(port, '0.0.0.0');
      });
      console.log(`[sync] WS 服务端已绑定到端口 ${port}`);
      break;
    } catch (err) {
      httpServer = null;
      if (err.code !== 'EADDRINUSE') {
        console.error(`绑定端口 ${port} 异常:`, err.message);
      }
    }
  }
  // 所有固定端口都被占用，使用随机端口
  if (!httpServer) {
    try {
      httpServer = http.createServer();
      await new Promise((resolve, reject) => {
        httpServer.once('error', (err2) => reject(err2));
        httpServer.once('listening', () => resolve());
        httpServer.listen(0, '0.0.0.0');
      });
      console.log(`[sync] WS 服务端已绑定到随机端口 ${httpServer.address().port}`);
    } catch (err2) {
      if (onError) onError('无法绑定端口: ' + err2.message);
      return { stop: () => {}, port: 0, broadcast: () => {} };
    }
  }

  actualPort = httpServer.address().port;

  // 将已绑定端口的 HTTP server 交给 WSS 接管
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    if (client) {
      console.log('[sync] WS 拒绝: 已有配对连接');
      ws.close(4001, 'already_paired');
      return;
    }

    console.log('[sync] WS 新连接');
    client = ws;
    let authed = false;

    authTimer = setTimeout(() => {
      if (!authed && client) {
        try { client.close(4002, 'auth_timeout'); } catch (e) {}
        client = null;
      }
    }, 10000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString('utf-8'));

        if (!authed) {
          if (msg.type === 'auth') {
            if (msg.token === targetToken) {
              authed = true;
              clearTimeout(authTimer);
              ws.send(JSON.stringify({ type: 'auth_ok' }));
              const remoteIp = ws._socket?.remoteAddress?.replace(/^::ffff:/, '') || '0.0.0.0';
              if (onPeerConnected) onPeerConnected({ deviceName: msg.deviceName || '未知设备', deviceId: msg.deviceId || '', ip: remoteIp });
            } else {
              clearTimeout(authTimer);
              ws.send(JSON.stringify({ type: 'auth_fail', reason: '配对码错误' }));
              setTimeout(() => {
                try { ws.close(4003, 'auth_fail'); } catch (e) {}
                client = null;
              }, 500);
            }
          } else {
            ws.send(JSON.stringify({ type: 'auth_fail', reason: '请先认证' }));
            try { ws.close(4003, 'auth_required'); } catch (e) {}
            client = null;
          }
          return;
        }

        if (msg.type === 'sync_full' || msg.type === 'note_add' ||
            msg.type === 'note_update' || msg.type === 'note_delete') {
          if (onMessage) onMessage(msg);
        } else if (msg.type === 'heartbeat') {
          ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        }
      } catch (e) {
        // ignore
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (client === ws) {
        client = null;
        if (authed && onPeerDisconnected) onPeerDisconnected();
      }
    });

    ws.on('error', () => {
      if (client === ws) {
        if (authed && onPeerDisconnected) onPeerDisconnected();
        client = null;
      }
    });
  });

  wss.on('error', (e) => {
    if (onError) onError('WebSocket 服务端错误: ' + e.message);
  });

  httpServer.on('error', (e) => {
    console.error('WS HTTP server error:', e.message);
  });

  function stop() {
    if (closed) return;
    closed = true;
    if (authTimer) clearTimeout(authTimer);
    if (client) {
      try { client.close(); } catch (e) {}
      client = null;
    }
    if (wss) {
      try { wss.close(); } catch (e) {}
      wss = null;
    }
    if (httpServer) {
      try { httpServer.close(); } catch (e) {}
      httpServer = null;
    }
  }

  function broadcast(msg) {
    if (client && client.readyState === 1) {
      try {
        client.send(JSON.stringify(msg));
      } catch (e) {
        // ignore
      }
    }
  }

  return { stop, port: actualPort, broadcast };
}

module.exports = { createServer };
