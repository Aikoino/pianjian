// 打包脚本：生成便携版 zip（< 100MB）
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const portableDir = path.join(distDir, '片笺-portable');
const unpackedDir = path.join(distDir, 'win-unpacked');
const sevenZip = path.join(rootDir, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const pkg = require(path.join(rootDir, 'package.json'));
const outName = `片笺_v${pkg.version}_portable.zip`;

// Step 1: 用 electron-builder 生成 asar + 复制 Electron（跳过 NSIS 安装包）
console.log('[1/3] 打包 asar...');
execSync(`npx electron-builder --win --c.electronDist="node_modules/electron/dist" --c.win.signAndEditExecutable=false --dir`, {
  stdio: 'inherit',
  cwd: rootDir
});

// Step 2: 复制并精简
console.log('[2/3] 精简 locales...');
fs.rmSync(portableDir, { recursive: true, force: true });
fs.cpSync(unpackedDir, portableDir, { recursive: true });

// 只保留中文 locale
const localesDir = path.join(portableDir, 'locales');
if (fs.existsSync(localesDir)) {
  fs.readdirSync(localesDir).forEach(f => {
    if (f !== 'zh-CN.pak') fs.rmSync(path.join(localesDir, f));
  });
}

// Step 3: 压缩为 zip
console.log('[3/3] 压缩 zip...');
const outPath = path.join(distDir, outName);
if (fs.existsSync(outPath)) fs.rmSync(outPath);
execSync(`"${sevenZip}" a -tzip -mx=9 "${outPath}" "${portableDir}"`, {
  stdio: 'inherit',
  cwd: distDir
});

const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ 打包完成: ${outName} (${sizeMB} MB)`);
