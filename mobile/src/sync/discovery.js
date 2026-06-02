import dgram from 'react-native-udp';
import { getDeviceId } from '../store/syncStore';
import { log } from '../utils/logger';

const UDP_PORT = 48483;
const BEACON_INTERVAL = 3000;

// 纯 JS SHA256，避免 expo-crypto 原生模块问题
function sha256(str) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const R = (x, n) => (x >>> n) | (x << (32 - n));
  // 兼容 TextEncoder 不可用的环境
  let msg;
  if (typeof TextEncoder !== 'undefined') {
    msg = new TextEncoder().encode(str);
  } else {
    const s = unescape(encodeURIComponent(str));
    msg = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) msg[i] = s.charCodeAt(i);
  }
  const l = msg.length * 8;
  const bl = Math.ceil((msg.length + 9) / 64) * 64;
  const buf = new Uint8Array(bl);
  buf.set(msg);
  buf[msg.length] = 0x80;
  new DataView(buf.buffer).setUint32(bl - 4, l, false);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let i = 0; i < bl; i += 64) {
    const w = new Array(64);
    for (let j = 0; j < 16; j++) w[j] = new DataView(buf.buffer, i + j * 4, 4).getUint32(0, false);
    for (let j = 16; j < 64; j++) {
      const s0 = R(w[j - 15], 7) ^ R(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = R(w[j - 2], 17) ^ R(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = R(e, 6) ^ R(e, 11) ^ R(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 = R(a, 2) ^ R(a, 13) ^ R(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const toHex = n => (n >>> 0).toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

let broadcastSocket = null;
let broadcastTimer = null;
let listenSocket = null;

export function startBroadcast(code, wsPort, deviceName) {
  stopBroadcast();
  log('UDP-广播', `准备开始广播 wsPort=${wsPort}`);

  try {
    const token = sha256(code);
    log('UDP-广播', `sha256 完成 token=${token.slice(0, 8)}...`);

    getDeviceId().then(deviceId => {
      log('UDP-广播', `deviceId=${deviceId.slice(0, 8)}...`);
      const payload = JSON.stringify({
        app: 'pianjian', version: 1, token, wsPort, deviceName, deviceId,
      });
      const message = Buffer.from(payload, 'utf-8');

      try {
        broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      } catch (e) {
        log('UDP-广播', `创建 socket 失败: ${e.message}`);
        return;
      }

      broadcastSocket.on('error', e => {
        log('UDP-广播', `socket 错误: ${e.message}`);
      });

      broadcastSocket.on('listening', () => {
        log('UDP-广播', `socket 已绑定，开始每 ${BEACON_INTERVAL}ms 发送 beacon`);
        function sendBeacon() {
          try {
            broadcastSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255', (err) => {
              if (err) log('UDP-广播', `发送失败: ${err.message}`);
            });
            log('UDP-广播', `beacon 已发送 wsPort=${wsPort}`);
          } catch (e) {
            log('UDP-广播', `发送异常: ${e.message}`);
          }
        }
        broadcastTimer = setInterval(sendBeacon, BEACON_INTERVAL);
        sendBeacon();
      });

      broadcastSocket.bind(() => {
        broadcastSocket.setBroadcast(true);
      });
    }).catch(e => {
      log('UDP-广播', `获取 deviceId 失败: ${e.message}`);
    });
  } catch (e) {
    log('UDP-广播', `初始化失败: ${e.message}`);
  }
}

export function stopBroadcast() {
  if (broadcastTimer) { clearInterval(broadcastTimer); broadcastTimer = null; }
  if (broadcastSocket) {
    try { broadcastSocket.close(); } catch (e) {}
    broadcastSocket = null;
  }
}

export function startListening(code, onFound, onError) {
  stopListening();
  log('UDP-监听', `准备监听端口 ${UDP_PORT}`);

  try {
    const targetToken = sha256(code);
    log('UDP-监听', `sha256 完成 targetToken=${targetToken.slice(0, 8)}...`);

    getDeviceId().then(selfDeviceId => {
      log('UDP-监听', `selfDeviceId=${selfDeviceId.slice(0, 8)}...`);

      try {
        listenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      } catch (e) {
        log('UDP-监听', `创建 socket 失败: ${e.message}`);
        if (onError) onError('UDP socket 创建失败: ' + e.message);
        return;
      }

      listenSocket.on('error', err => {
        log('UDP-监听', `socket 错误: ${err.message}`);
        if (onError) onError(err.message);
      });

      listenSocket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString('utf-8'));
          log('UDP-监听', `收到消息 from=${rinfo.address}:${rinfo.port} app=${data.app}`);
          if (data.app !== 'pianjian' || data.version !== 1) return;
          if (data.deviceId === selfDeviceId) {
            log('UDP-监听', `忽略自己的广播`);
            return;
          }
          log('UDP-监听', `token=${data.token?.slice(0, 8)} vs 目标=${targetToken.slice(0, 8)}`);
          if (data.token === targetToken) {
            log('UDP-监听', `匹配成功! 对方 IP=${rinfo.address} wsPort=${data.wsPort}`);
            onFound({
              ip: rinfo.address, wsPort: data.wsPort,
              deviceName: data.deviceName || '未知设备', deviceId: data.deviceId,
            });
          } else {
            log('UDP-监听', `token 不匹配`);
          }
        } catch (e) {
          log('UDP-监听', `解析失败: ${e.message}`);
        }
      });

      listenSocket.bind(UDP_PORT, () => {
        try { listenSocket.setBroadcast(true); } catch (e) {}
        log('UDP-监听', `已绑定到端口 ${UDP_PORT}，等待 beacon...`);
      });
    }).catch(e => {
      log('UDP-监听', `获取 deviceId 失败: ${e.message}`);
      if (onError) onError('初始化失败: ' + e.message);
    });
  } catch (e) {
    log('UDP-监听', `初始化失败: ${e.message}`);
    if (onError) onError('初始化失败: ' + e.message);
  }
}

export function stopListening() {
  if (listenSocket) { try { listenSocket.close(); } catch (e) {} listenSocket = null; }
}
