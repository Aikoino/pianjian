import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@pianjian_sync';

let cached = null;

async function loadSync() {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cached = raw ? JSON.parse(raw) : {};
  } catch {
    cached = {};
  }
  return cached;
}

async function saveSync(data) {
  cached = data;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function getDeviceId() {
  const sync = await loadSync();
  if (!sync.deviceId) {
    sync.deviceId = generateUUID();
    await saveSync(sync);
  }
  return sync.deviceId;
}

export async function getDeviceName() {
  const sync = await loadSync();
  return sync.deviceName || 'Android 设备';
}

export async function setPairedDevice(info) {
  const sync = await loadSync();
  sync.pairedDevice = info;
  await saveSync(sync);
}

export async function clearPairedDevice() {
  const sync = await loadSync();
  delete sync.pairedDevice;
  await saveSync(sync);
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : r & 0x3 | 0x8).toString(16);
  });
}
