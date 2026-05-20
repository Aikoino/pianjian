// 启动 Electron 应用的 Node.js 包装脚本
// 解决 Windows 上 ELECTRON_RUN_AS_NODE 环境变量导致的问题
const { spawn } = require('child_process');
const path = require('path');

// 获取 electron 可执行文件路径
const electron = require('electron');
const args = [path.join(__dirname, 'main.js')];

// 启动 electron，清除 ELECTRON_RUN_AS_NODE
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, args, {
  stdio: 'inherit',
  env,
  windowsHide: false
});

child.on('close', (code) => process.exit(code));
