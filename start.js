// 启动 Electron 应用的 Node.js 包装脚本
// 支持 --data-dir <路径> 参数启动多实例
const { spawn } = require('child_process');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
let dataDir = null;
const dataDirIdx = args.indexOf('--data-dir');
if (dataDirIdx !== -1 && args.length > dataDirIdx + 1) {
  dataDir = path.resolve(args[dataDirIdx + 1]);
}

// 获取 electron 可执行文件路径
const electron = require('electron');
const mainArgs = [path.join(__dirname, 'main.js')];

// 启动 electron，清除 ELECTRON_RUN_AS_NODE
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (dataDir) {
  env.PIANJIAN_DATA_DIR = dataDir;
}

const child = spawn(electron, mainArgs, {
  stdio: 'inherit',
  env,
  windowsHide: false
});

child.on('close', (code) => process.exit(code));
