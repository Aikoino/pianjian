import { Server as TcpServer } from 'react-native-tcp-socket';
import { sha256 } from '../utils/crypto';
import { log } from '../utils/logger';

// 纯手写最小 WebSocket 服务器（不依赖 ws 库的 Node.js stream）
export function createServer(code, onMessage, onPeerConnected, onPeerDisconnected, onError) {
  return new Promise(async (resolve, reject) => {
    try {
    const targetToken = await sha256(code);
    log('WS-服务器', `创建服务器 token=${targetToken.slice(0, 8)}...`);
    let wsSocket = null;
    let authTimer = null;
    let closed = false;

    const tcpServer = new TcpServer({ reuseAddress: true }, (socket) => {
      log('WS-服务器', `收到 TCP 连接 from=${socket.remoteAddress}`);
      // 只允许一个连接
      if (wsSocket) {
        log('WS-服务器', `已有连接，拒绝新连接`);
        try { socket.destroy(); } catch (e) {}
        return;
      }

      // WebSocket 握手
      let headerBuf = '';
      const onFirstData = (data) => {
        headerBuf += data.toString('utf-8');
        const endIdx = headerBuf.indexOf('\r\n\r\n');
        if (endIdx === -1) return; // 等更多数据

        socket.removeListener('data', onFirstData);

        const headerPart = headerBuf.substring(0, endIdx);
        const keyMatch = headerPart.match(/Sec-WebSocket-Key:\s*(.+)/i);
        if (!keyMatch) {
          log('WS-服务器', `握手失败: 无 Sec-WebSocket-Key`);
          socket.destroy();
          return;
        }

        const acceptKey = computeSha1Base64(keyMatch[1].trim() + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
        const response =
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
          '\r\n';
        socket.write(response);

        wsSocket = socket;
        let authed = false;
        let frameBuf = Buffer.alloc(0);
        log('WS-服务器', `WebSocket 握手完成，等待认证...`);

        authTimer = setTimeout(() => {
          if (!authed && wsSocket) {
            log('WS-服务器', `认证超时 (10s)`);
            try { wsSocket.destroy(); } catch (e) {}
            wsSocket = null;
          }
        }, 10000);

        // 先注册帧解析监听器，再处理剩余数据，避免数据丢失
        socket.on('data', (chunk) => {
          frameBuf = Buffer.concat([frameBuf, chunk]);
          while (true) {
            const result = tryParseFrame(frameBuf);
            if (!result) break;
            frameBuf = frameBuf.slice(result.consumed);
            try {
              const msg = JSON.parse(result.payload);
              log('WS-服务器', `收到: ${msg.type}`);
              if (!authed) {
                if (msg.type === 'auth' && msg.token === targetToken) {
                  authed = true;
                  clearTimeout(authTimer);
                  sendWs(socket, { type: 'auth_ok' });
                  const remoteIp = socket.remoteAddress?.replace(/^::ffff:/, '') || '0.0.0.0';
                  log('WS-服务器', `认证成功! 对方=${msg.deviceName}`);
                  if (onPeerConnected) onPeerConnected({
                    deviceName: msg.deviceName || '未知设备',
                    deviceId: msg.deviceId || '',
                    ip: remoteIp,
                  });
                } else {
                  log('WS-服务器', `认证失败: token 不匹配`);
                  sendWs(socket, { type: 'auth_fail', reason: '配对码错误' });
                  setTimeout(() => { try { socket.destroy(); } catch (e) {} }, 500);
                }
                return;
              }
              if (msg.type === 'sync_full' || msg.type === 'note_add' ||
                  msg.type === 'note_update' || msg.type === 'note_delete') {
                if (onMessage) onMessage(msg);
              }
            } catch (e) {}
          }
        });

        socket.on('close', () => {
          clearTimeout(authTimer);
          if (wsSocket === socket) {
            wsSocket = null;
            if (authed && onPeerDisconnected) onPeerDisconnected();
          }
        });

        socket.on('error', () => {
          if (wsSocket === socket) wsSocket = null;
        });

        // 处理握手后剩余数据（auth 帧可能和 HTTP 头在同一个 TCP 包里）
        if (headerBuf.length > endIdx + 4) {
          const remaining = Buffer.from(headerBuf.substring(endIdx + 4));
          socket.emit('data', remaining);
        }
      };

      socket.on('data', onFirstData);
    });

    function tryBind(port) {
      if (closed) return;
      tcpServer.listen(port, '0.0.0.0');
    }

    tcpServer.on('listening', () => {
      const actualPort = tcpServer.address().port;
      log('WS-服务器', `服务器已启动，端口 ${actualPort}`);
      resolve({
        port: actualPort,
        broadcast(msg) {
          sendWs(wsSocket, msg);
        },
        stop() {
          if (closed) return;
          closed = true;
          if (authTimer) clearTimeout(authTimer);
          if (wsSocket) { try { wsSocket.destroy(); } catch (e) {} wsSocket = null; }
          try { tcpServer.close(); } catch (e) {}
        },
      });
    });

    tcpServer.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        tryBind(0);
      } else {
        if (onError) onError('服务器启动失败: ' + e.message);
        resolve({ port: 0, broadcast: () => {}, stop: () => {} });
      }
    });

    tryBind(48484);
    } catch (e) {
      log('WS-服务器', `创建异常: ${e.message}`);
      if (onError) onError('服务器创建失败: ' + e.message);
      reject(e);
    }
  });
}

// ---- WebSocket 帧处理 ----

function sendWs(socket, obj) {
  if (!socket || socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(obj), 'utf-8');

  // 服务器发送的帧不能 mask（RFC 6455 规定）
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = payload.length; // 不加 0x80 (no mask)
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  try { socket.write(Buffer.concat([header, payload])); } catch (e) {}
}

function tryParseFrame(buf) {
  if (buf.length < 2) return null;
  const firstByte = buf[0];
  const secondByte = buf[1];
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  const maskSize = isMasked ? 4 : 0;
  const totalNeeded = offset + maskSize + payloadLen;
  if (buf.length < totalNeeded) return null;

  let mask = null;
  if (isMasked) {
    mask = buf.slice(offset, offset + 4);
    offset += 4;
  }

  const payload = Buffer.from(buf.slice(offset, offset + payloadLen));
  if (mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = payload[i] ^ mask[i & 3];
    }
  }

  return { payload: payload.toString('utf-8'), consumed: totalNeeded };
}

// ---- SHA1 for WebSocket accept key ----

function computeSha1Base64(str) {
  const bytes = sha1(str);
  return bytesToBase64(bytes);
}

function sha1(message) {
  const msg = unescape(encodeURIComponent(message));
  const M = [];
  for (let i = 0; i < msg.length; i++) {
    M[i >> 2] |= msg.charCodeAt(i) << (24 - (i % 4) * 8);
  }
  M[msg.length >> 2] |= 0x80 << (24 - (msg.length % 4) * 8);
  if (msg.length % 64 > 55) M.push(0);
  M.push(msg.length * 8);

  let H0 = 0x67452301, H1 = 0xEFCDAB89, H2 = 0x98BADCFE, H3 = 0x10325476, H4 = 0xC3D2E1F0;

  for (let j = 0; j < M.length; j += 16) {
    const W = new Array(80);
    for (let i = 0; i < 16; i++) W[i] = M[j + i] >>> 0;
    for (let i = 16; i < 80; i++) W[i] = rotl(W[i-3] ^ W[i-8] ^ W[i-14] ^ W[i-16], 1) >>> 0;
    let a = H0, b = H1, c = H2, d = H3, e = H4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = (rotl(a, 5) + f + e + k + W[i]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    H0 = (H0 + a) | 0; H1 = (H1 + b) | 0;
    H2 = (H2 + c) | 0; H3 = (H3 + d) | 0; H4 = (H4 + e) | 0;
  }
  return [H0, H1, H2, H3, H4].map(h => [
    (h >> 24) & 0xff, (h >> 16) & 0xff, (h >> 8) & 0xff, h & 0xff
  ]).flat();
}

function rotl(n, s) { return ((n << s) | (n >>> (32 - s))) >>> 0; }

function bytesToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i], b2 = i+1 < bytes.length ? bytes[i+1] : 0, b3 = i+2 < bytes.length ? bytes[i+2] : 0;
    result += chars[(b1 >> 2) & 63];
    result += chars[((b1 & 3) << 4) | ((b2 >> 4) & 15)];
    result += i+1 < bytes.length ? chars[((b2 & 15) << 2) | ((b3 >> 6) & 3)] : '=';
    result += i+2 < bytes.length ? chars[b3 & 63] : '=';
  }
  return result;
}
