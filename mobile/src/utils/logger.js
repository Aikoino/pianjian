// 调试日志系统 — 记录所有连接步骤，同步界面可显示
const MAX_LOGS = 500;

let logs = [];
let listeners = new Set();

export function log(tag, msg) {
  const entry = `[${tag}] ${msg}`;
  const time = new Date().toLocaleTimeString();
  logs.push({ time, tag, msg, full: `${time} ${entry}` });
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
  console.log(entry);
  listeners.forEach(fn => fn([...logs]));
}

export function getLogs() {
  return [...logs];
}

export function clearLogs() {
  logs = [];
  listeners.forEach(fn => fn([]));
}

export function onLog(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
