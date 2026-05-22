const { loadNotes, saveNotes } = require('./data-store');
const { getDeviceId, getDeviceName, setPairedDevice, clearPairedDevice } = require('./sync-store');
const { startBroadcast, stopBroadcast, startListening, stopListening } = require('./discovery');
const { createServer } = require('./ws-server');
const { connect } = require('./ws-client');

const PAIRING_TIMEOUT = 120000; // 2 minutes
const CONNECT_TIMEOUT = 15000;  // 15 seconds

// State machine:
// idle -> pairing  (initiator: beacon + WS server)
// idle -> discovering (joiner: UDP listener)
// pairing -> connected (joiner authed)
// discovering -> connected (found beacon, WS authed)
// connected -> idle (disconnect)
// pairing/discovering -> idle (timeout or cancel)

let state = { status: 'idle' };
let statusCallbacks = [];
let server = null;
let client = null;
let pairingTimer = null;
let isApplyingRemote = false;

function notifyStatus() {
  const s = { ...state };
  statusCallbacks.forEach(cb => cb(s));
}

function onStatusChange(cb) {
  statusCallbacks.push(cb);
  return () => {
    statusCallbacks = statusCallbacks.filter(c => c !== cb);
  };
}

function getStatus() {
  return { ...state };
}

function setStatus(s) {
  state = { ...state, ...s };
  notifyStatus();
}

// ---- Merge logic ----

function mergeNotes(localNotes, remoteNotes) {
  const merged = new Map();
  for (const n of localNotes) merged.set(n.id, n);
  for (const rn of remoteNotes) {
    const existing = merged.get(rn.id);
    if (!existing) {
      merged.set(rn.id, rn);
    } else {
      const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      const remoteTime = new Date(rn.updatedAt || rn.createdAt || 0).getTime();
      if (remoteTime > existingTime) {
        merged.set(rn.id, rn);
      }
    }
  }
  return Array.from(merged.values());
}

function applyRemoteChange(handler) {
  isApplyingRemote = true;
  try {
    handler();
  } finally {
    isApplyingRemote = false;
  }
}

// ---- Broadcast to peer ----

function broadcast(msg) {
  if (state.status !== 'connected') return;
  if (server) server.broadcast(msg);
  if (client) client.send(msg);
}

// ---- Pairing: initiator ----

async function startPairing() {
  if (state.status !== 'idle') return null;

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + PAIRING_TIMEOUT;
  const deviceName = getDeviceName();
  const deviceId = getDeviceId();

  setStatus({ status: 'pairing', code, expiresAt, deviceName });

  // Start WS server
  server = await createServer(
    code,
    (msg) => handleRemoteMessage(msg),
    (peerInfo) => {
      // Peer connected and authed
      clearTimeout(pairingTimer);
      setPairedDevice({
        deviceId: peerInfo.deviceId,
        deviceName: peerInfo.deviceName,
        ip: peerInfo.ip,
        wsPort: server.port,
        pairedAt: new Date().toISOString()
      });
      setStatus({ status: 'connected', peerName: peerInfo.deviceName });
    },
    () => {
      // Peer disconnected
      stopSync();
      setStatus({ status: 'idle', disconnected: true });
    },
    (err) => {
      setStatus({ status: 'error', error: err });
    }
  );

  // Start UDP broadcast
  startBroadcast(code, server.port, deviceName);

  // Pairing timeout
  pairingTimer = setTimeout(() => {
    if (state.status === 'pairing') {
      stopSync();
      setStatus({ status: 'idle', timeout: true });
    }
  }, PAIRING_TIMEOUT);

  return { code, expiresAt };
}

// ---- Pairing: joiner ----

function joinWithCode(code) {
  if (state.status !== 'idle') return;

  setStatus({ status: 'discovering' });

  let found = false;

  startListening(
    code,
    (peerInfo) => {
      if (found) return;
      found = true;
      stopListening();
      clearTimeout(pairingTimer);

      setStatus({ status: 'connecting' });

      // Connection-phase timeout (shorter than full pairing timeout)
      clearTimeout(pairingTimer);
      pairingTimer = setTimeout(() => {
        stopSync();
        setStatus({ status: 'idle', timeout: true });
      }, CONNECT_TIMEOUT);

      // Connect to peer
      client = connect(
        peerInfo.ip,
        peerInfo.wsPort,
        code,
        (msg) => handleRemoteMessage(msg),
        () => {
          // Connected
          clearTimeout(pairingTimer);
          setPairedDevice({
            deviceId: peerInfo.deviceId,
            deviceName: peerInfo.deviceName,
            ip: peerInfo.ip,
            wsPort: peerInfo.wsPort,
            pairedAt: new Date().toISOString()
          });
          setStatus({ status: 'connected', peerName: peerInfo.deviceName });
          // Full sync: send all local notes
          const notes = loadNotes();
          broadcast({ type: 'sync_full', notes, deviceId: getDeviceId() });
        },
        () => {
          // Disconnected
          stopSync();
          setStatus({ status: 'idle', disconnected: true });
        },
        (err) => {
          setStatus({ status: 'error', error: err });
        },
        getDeviceName(),
        getDeviceId()
      );
    },
    (err) => {
      setStatus({ status: 'error', error: err });
    }
  );

  // Discovery timeout (same 2 min)
  pairingTimer = setTimeout(() => {
    if (state.status === 'discovering' || state.status === 'connecting') {
      stopSync();
      setStatus({ status: 'idle', timeout: true });
    }
  }, PAIRING_TIMEOUT);
}

// ---- Cancel / Disconnect ----

function stopSync() {
  if (pairingTimer) {
    clearTimeout(pairingTimer);
    pairingTimer = null;
  }
  stopBroadcast();
  stopListening();
  if (server) {
    server.stop();
    server = null;
  }
  if (client) {
    client.disconnect();
    client = null;
  }
}

function cancelPairing() {
  stopSync();
  setStatus({ status: 'idle' });
}

function disconnect() {
  stopSync();
  clearPairedDevice();
  setStatus({ status: 'idle' });
}

// ---- Remote message handling ----

function handleRemoteMessage(msg) {
  applyRemoteChange(() => {
    switch (msg.type) {
      case 'sync_full': {
        const local = loadNotes();
        const merged = mergeNotes(local, msg.notes);
        saveNotes(merged);
        // If we haven't sent our notes yet (as server), send them
        if (server && state.status === 'connected') {
          broadcast({ type: 'sync_full', notes: local, deviceId: getDeviceId() });
        }
        break;
      }
      case 'note_add': {
        if (!msg.note) break;
        if (findLocalNote(msg.note.id)) break; // already exists
        const notes = loadNotes();
        notes.push(msg.note);
        saveNotes(notes);
        break;
      }
      case 'note_update': {
        if (!msg.id) break;
        const notes = loadNotes();
        const idx = notes.findIndex(n => n.id === msg.id);
        if (idx === -1) break;
        const existing = notes[idx];
        const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
        const remoteTime = new Date(msg.updatedAt || '').getTime();
        if (remoteTime > existingTime) {
          Object.assign(notes[idx], msg.changes, { updatedAt: msg.updatedAt || new Date().toISOString() });
          saveNotes(notes);
        }
        break;
      }
      case 'note_delete': {
        if (!msg.id) break;
        let notes = loadNotes();
        notes = notes.filter(n => n.id !== msg.id);
        saveNotes(notes);
        break;
      }
    }
  });

  // Notify renderer to refresh
  notifyRenderer();
}

function findLocalNote(id) {
  return loadNotes().find(n => n.id === id);
}

// ---- Notify renderer ----

let mainWindowRef = null;

function setMainWindow(w) {
  mainWindowRef = w;
}

function notifyRenderer() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('sync:dataChanged');
  }
}

// ---- Init ----

function init(mainWindow) {
  setMainWindow(mainWindow);
}

module.exports = {
  init, getStatus, onStatusChange,
  startPairing, joinWithCode, cancelPairing, disconnect,
  broadcast
};
