import notesStore from '../store/notesStore';
import { getDeviceId, getDeviceName, setPairedDevice, clearPairedDevice } from '../store/syncStore';
import { startBroadcast, stopBroadcast, startListening, stopListening } from './discovery';
import { connect } from './wsClient';
import { createServer } from './wsServer';

const PAIRING_TIMEOUT = 120000;
const CONNECT_TIMEOUT = 15000;

let state = { status: 'idle', role: null };
let statusCallbacks = [];
let server = null;
let client = null;
let pairingTimer = null;
let isApplyingRemote = false;

function notifyStatus() {
  statusCallbacks.forEach(cb => cb({ ...state }));
}

export function onStatusChange(cb) {
  statusCallbacks.push(cb);
  return () => { statusCallbacks = statusCallbacks.filter(c => c !== cb); };
}

export function getStatus() {
  return { ...state };
}

function setStatus(s) {
  const prev = state.status;
  state = { ...state, ...s };
  if (prev !== state.status) {
    console.log(`[sync] 状态: ${prev} → ${state.status}`);
  }
  notifyStatus();
}

// ---- Merge logic ----

function mergeNotes(localNotes, remoteNotes, remoteRole) {
  const merged = new Map();
  for (const n of localNotes) merged.set(n.id, n);
  for (const rn of remoteNotes) {
    const existing = merged.get(rn.id);
    if (!existing) {
      merged.set(rn.id, rn);
    } else {
      const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      const remoteTime = new Date(rn.updatedAt || rn.createdAt || 0).getTime();
      const diff = Math.abs(existingTime - remoteTime);
      if (diff < 2000 && remoteRole === 'follower') continue;
      if (remoteTime > existingTime) {
        merged.set(rn.id, rn);
      }
    }
  }
  return Array.from(merged.values());
}

function applyRemoteChange(handler) {
  isApplyingRemote = true;
  try { handler(); } finally { isApplyingRemote = false; }
}

function broadcast(msg) {
  if (state.status !== 'connected') return;
  if (server) server.broadcast(msg);
  if (client) client.send(msg);
}

function handleRemoteMessage(msg) {
  applyRemoteChange(() => {
    switch (msg.type) {
      case 'sync_full': {
        if (msg.initialSync && state.role === 'follower') {
          // 从属端收到权威端合并后的数据，直接替换
          notesStore.setNotes(msg.notes);
        } else if (state.role === 'authority' && !msg.initialSync) {
          // 权威端收到从属端首轮数据，合并一次后回复
          const local = notesStore.getNotes();
          const merged = mergeNotes(local, msg.notes, msg.role);
          notesStore.setNotes(merged);
          getDeviceId().then(deviceId => {
            broadcast({ type: 'sync_full', notes: merged, deviceId, role: 'authority', initialSync: true });
          });
        }
        // 权威端收到 initialSync 的 sync_full → 忽略（不应该发生）
        // 从属端收到非 initialSync 的 sync_full → 忽略（只接受权威端的 initialSync 回复）
        break;
      }
      case 'note_add': {
        if (!msg.note) break;
        notesStore.insertNote(msg.note);
        break;
      }
      case 'note_update': {
        if (!msg.id) break;
        const notes = notesStore.getNotes();
        const note = notes.find(n => n.id === msg.id);
        if (!note) break;
        const localTime = new Date(note.updatedAt || note.createdAt || 0).getTime();
        const remoteTime = new Date(msg.updatedAt || '').getTime();
        if (remoteTime > localTime) {
          notesStore.updateNote(msg.id, msg.changes);
        }
        break;
      }
      case 'note_delete': {
        if (!msg.id) break;
        notesStore.deleteNote(msg.id);
        break;
      }
    }
  });
}

// ============================================================
// 方式一：手机发起配对（手机 = authority，WS 服务器）
// ============================================================

export async function startPairing() {
  if (state.status !== 'idle') return null;

  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const code = String(100000 + (arr[0] % 900000));
  const expiresAt = Date.now() + PAIRING_TIMEOUT;
  const deviceName = await getDeviceName();

  setStatus({ status: 'pairing', code, expiresAt, deviceName, role: 'authority' });

  // 启动 WS 服务器
  server = await createServer(
    code,
    (msg) => handleRemoteMessage(msg),
    (peerInfo) => {
      clearTimeout(pairingTimer);
      setPairedDevice({
        deviceId: peerInfo.deviceId,
        deviceName: peerInfo.deviceName,
        ip: peerInfo.ip,
        wsPort: server.port,
        pairedAt: new Date().toISOString(),
      });
      setStatus({ status: 'connected', peerName: peerInfo.deviceName, role: 'authority' });
    },
    () => {
      stopSync();
      setStatus({ status: 'idle', disconnected: true });
    },
    (err) => {
      setStatus({ status: 'error', error: err });
    }
  );

  if (server.port === 0) {
    setStatus({ status: 'error', error: '无法启动服务器' });
    return null;
  }

  // 开始 UDP 广播
  startBroadcast(code, server.port, deviceName);

  // 超时处理
  pairingTimer = setTimeout(() => {
    if (state.status === 'pairing') {
      stopSync();
      setStatus({ status: 'idle', timeout: true });
    }
  }, PAIRING_TIMEOUT);

  return { code, expiresAt };
}

// ============================================================
// 方式二：手机输入配对码加入（UDP 发现，手机 = follower）
// ============================================================

export async function joinWithCode(code) {
  if (state.status !== 'idle') return;

  setStatus({ status: 'discovering', role: 'follower' });

  const deviceName = await getDeviceName();
  const deviceId = await getDeviceId();
  let found = false;

  startListening(
    code,
    (peerInfo) => {
      if (found) return;
      found = true;
      stopListening();
      clearTimeout(pairingTimer);

      setStatus({ status: 'connecting' });

      clearTimeout(pairingTimer);
      pairingTimer = setTimeout(() => {
        stopSync();
        setStatus({ status: 'idle', timeout: true });
      }, CONNECT_TIMEOUT);

      client = connect(
        peerInfo.ip, peerInfo.wsPort, code,
        (msg) => handleRemoteMessage(msg),
        () => {
          clearTimeout(pairingTimer);
          setPairedDevice({
            deviceId: peerInfo.deviceId, deviceName: peerInfo.deviceName,
            ip: peerInfo.ip, wsPort: peerInfo.wsPort,
            pairedAt: new Date().toISOString(),
          });
          setStatus({ status: 'connected', peerName: peerInfo.deviceName, role: 'follower' });
          const notes = notesStore.getNotes();
          broadcast({ type: 'sync_full', notes, deviceId, role: 'follower' });
        },
        () => { stopSync(); setStatus({ status: 'idle', disconnected: true }); },
        (err) => { setStatus({ status: 'error', error: err }); },
        deviceName, deviceId
      );
    },
    (err) => { setStatus({ status: 'error', error: err }); }
  );

  pairingTimer = setTimeout(() => {
    if (state.status === 'discovering' || state.status === 'connecting') {
      stopSync();
      setStatus({ status: 'idle', timeout: true });
    }
  }, PAIRING_TIMEOUT);
}

// ============================================================
// 方式三：手动输入 IP + 端口（备用方案，手机 = follower）
// ============================================================

export async function connectByIP(ip, port, code) {
  if (state.status !== 'idle') return;

  setStatus({ status: 'connecting', role: 'follower' });

  const deviceName = await getDeviceName();
  const deviceId = await getDeviceId();

  clearTimeout(pairingTimer);
  pairingTimer = setTimeout(() => {
    stopSync();
    setStatus({ status: 'idle', timeout: true });
  }, CONNECT_TIMEOUT);

  client = connect(
    ip, Number(port), code,
    (msg) => handleRemoteMessage(msg),
    () => {
      clearTimeout(pairingTimer);
      setPairedDevice({
        deviceId: '', deviceName: '桌面设备',
        ip, wsPort: Number(port),
        pairedAt: new Date().toISOString(),
      });
      setStatus({ status: 'connected', peerName: '桌面设备', role: 'follower' });
      const notes = notesStore.getNotes();
      broadcast({ type: 'sync_full', notes, deviceId, role: 'follower' });
    },
    () => { stopSync(); setStatus({ status: 'idle', disconnected: true }); },
    (err) => { setStatus({ status: 'error', error: err }); },
    deviceName, deviceId
  );
}

// ---- Cancel / Disconnect ----

function stopSync() {
  if (pairingTimer) { clearTimeout(pairingTimer); pairingTimer = null; }
  stopBroadcast();
  stopListening();
  if (server) { server.stop(); server = null; }
  if (client) { client.disconnect(); client = null; }
}

export function cancelPairing() {
  stopSync();
  setStatus({ status: 'idle', role: null });
}

export function disconnect() {
  stopSync();
  clearPairedDevice();
  setStatus({ status: 'idle', role: null });
}

// ---- Init ----

export function init() {
  return notesStore.onChange((notes) => {
    if (isApplyingRemote) return;
    if (state.status !== 'connected') return;
    getDeviceId().then(deviceId => {
      broadcast({ type: 'sync_full', notes, deviceId, role: state.role });
    });
  });
}
