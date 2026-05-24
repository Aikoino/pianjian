const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');

const UDP_PORT = 48483;
const BEACON_INTERVAL = 3000;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getLocalIPs() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function getLocalIP() {
  const ips = getLocalIPs();
  return ips[0] || '127.0.0.1';
}

let broadcastSocket = null;
let broadcastTimer = null;

function startBroadcast(code, wsPort, deviceName) {
  stopBroadcast();
  const token = sha256(code);
  const deviceId = require('./sync-store').getDeviceId();
  const payload = JSON.stringify({
    app: 'pianjian',
    version: 1,
    token,
    wsPort,
    deviceName,
    deviceId
  });
  const message = Buffer.from(payload, 'utf-8');

  console.log(`[sync] 开始广播: deviceId=${deviceId.slice(0,8)} wsPort=${wsPort} token=${token.slice(0,8)}`);

  broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  broadcastSocket.on('error', (e) => console.error('[sync] 广播错误:', e.message));

  broadcastSocket.bind(() => {
    broadcastSocket.setBroadcast(true);
  });

  function sendBeacon() {
    try {
      broadcastSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255');
    } catch (e) {
      // ignore
    }
  }

  broadcastTimer = setInterval(sendBeacon, BEACON_INTERVAL);
  sendBeacon();
}

function stopBroadcast() {
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
  if (broadcastSocket) {
    try { broadcastSocket.close(); } catch (e) {}
    broadcastSocket = null;
  }
}

let listenSocket = null;

function startListening(code, onFound, onError) {
  stopListening();
  const targetToken = sha256(code);
  const selfDeviceId = require('./sync-store').getDeviceId();
  console.log(`[sync] 开始监听: deviceId=${selfDeviceId.slice(0,8)} targetToken=${targetToken.slice(0,8)}`);

  listenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  listenSocket.on('error', (err) => {
    console.error('[sync] 监听错误:', err);
    if (onError) onError(err.message);
  });

  listenSocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString('utf-8'));
      if (data.app !== 'pianjian' || data.version !== 1) {
        console.log(`[sync] 忽略: 非本应用数据 app=${data.app}`);
        return;
      }
      if (data.deviceId === selfDeviceId) {
        console.log(`[sync] 忽略: 自己发出的广播`);
        return;
      }
      console.log(`[sync] 收到广播: from=${data.deviceId?.slice(0,8)} ip=${rinfo.address} wsPort=${data.wsPort} token=${data.token?.slice(0,8)}`);
      if (data.token === targetToken) {
        console.log(`[sync] ✓ token 匹配! 连接到 ${rinfo.address}:${data.wsPort}`);
        onFound({
          ip: rinfo.address,
          wsPort: data.wsPort,
          deviceName: data.deviceName || '未知设备',
          deviceId: data.deviceId
        });
      } else {
        console.log(`[sync] ✗ token 不匹配`);
      }
    } catch (e) {
      console.error('[sync] 解析广播消息失败:', e.message);
    }
  });

  listenSocket.bind(UDP_PORT, () => {
    try { listenSocket.setBroadcast(true); } catch (e) {}
    console.log(`[sync] 已绑定到 UDP 端口 ${UDP_PORT}`);
  });
}

function stopListening() {
  if (listenSocket) {
    try { listenSocket.close(); } catch (e) {}
    listenSocket = null;
  }
}

module.exports = {
  startBroadcast, stopBroadcast,
  startListening, stopListening,
  getLocalIPs, getLocalIP
};
