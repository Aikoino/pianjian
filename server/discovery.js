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

let broadcastSocket = null;
let broadcastTimer = null;

function startBroadcast(code, wsPort, deviceName) {
  stopBroadcast();
  const token = sha256(code);
  const payload = JSON.stringify({
    app: 'pianjian',
    version: 1,
    token,
    wsPort,
    deviceName,
    deviceId: require('./sync-store').getDeviceId()
  });
  const message = Buffer.from(payload, 'utf-8');

  broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  broadcastSocket.on('error', () => {});

  broadcastSocket.bind(() => {
    broadcastSocket.setBroadcast(true);
  });

  broadcastTimer = setInterval(() => {
    try {
      broadcastSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255');
    } catch (e) {
      // ignore
    }
  }, BEACON_INTERVAL);

  // Send immediately
  try {
    broadcastSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255');
  } catch (e) {
    // ignore
  }
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

  listenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  listenSocket.on('error', (err) => {
    if (onError) onError(err.message);
  });

  listenSocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString('utf-8'));
      if (data.app !== 'pianjian' || data.version !== 1) return;
      if (data.deviceId === selfDeviceId) return; // skip self
      if (data.token === targetToken) {
        onFound({
          ip: rinfo.address,
          wsPort: data.wsPort,
          deviceName: data.deviceName || '未知设备',
          deviceId: data.deviceId
        });
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  listenSocket.bind(UDP_PORT, () => {
    try { listenSocket.setBroadcast(true); } catch (e) {}
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
  getLocalIPs
};
