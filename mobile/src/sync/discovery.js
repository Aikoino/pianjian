import dgram from 'react-native-udp';
import { sha256 } from '../utils/crypto';
import { getDeviceId } from '../store/syncStore';
import { log } from '../utils/logger';

const UDP_PORT = 48483;
const BEACON_INTERVAL = 3000;

let broadcastSocket = null;
let broadcastTimer = null;
let listenSocket = null;

export function startBroadcast(code, wsPort, deviceName) {
  stopBroadcast();
  log('UDP-广播', `准备开始广播 wsPort=${wsPort}`);

  let token;
  sha256(code).then(t => {
    token = t;
    log('UDP-广播', `sha256 完成 token=${token.slice(0, 8)}...`);
    return getDeviceId();
  }).then(deviceId => {
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
    log('UDP-广播', `初始化失败: ${e.message}`);
  });
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

  sha256(code).then(targetToken => {
    log('UDP-监听', `sha256 完成 targetToken=${targetToken.slice(0, 8)}...`);
    return getDeviceId();
  }).then(selfDeviceId => {
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
    log('UDP-监听', `初始化失败: ${e.message}`);
    if (onError) onError('初始化失败: ' + e.message);
  });
}

export function stopListening() {
  if (listenSocket) { try { listenSocket.close(); } catch (e) {} listenSocket = null; }
}
