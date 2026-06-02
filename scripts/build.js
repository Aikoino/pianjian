// 打包脚本：生成便携版 zip（< 100MB）
const { execSync } = require('child_process');
const { rcedit } = require('rcedit');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const portableDir = path.join(distDir, '片笺-portable');
const unpackedDir = path.join(distDir, 'win-unpacked');
const sevenZip = path.join(rootDir, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const pkg = require(path.join(rootDir, 'package.json'));
const outName = `片笺_v${pkg.version}_portable.zip`;

async function build() {
  // Step 1: 用 electron-builder 生成 asar + 复制 Electron
  console.log('[1/4] 打包 asar...');
  execSync(`npx electron-builder --win --c.electronDist="node_modules/electron/dist" --c.win.signAndEditExecutable=false --dir`, {
    stdio: 'inherit',
    cwd: rootDir
  });

  // Step 2: 用 rcedit 设置 exe 图标
  console.log('[2/4] 设置 exe 图标...');
  const iconPath = path.join(rootDir, 'build', 'icon.ico');
  if (fs.existsSync(iconPath)) {
    await rcedit(path.join(unpackedDir, '片笺.exe'), { icon: iconPath });
    console.log('  win-unpacked 图标已设置');
  }

  // Step 3: 复制并精简
  console.log('[3/4] 精简 locales...');
  fs.rmSync(portableDir, { recursive: true, force: true });
  fs.cpSync(unpackedDir, portableDir, { recursive: true });

  // 只保留中文 locale
  const localesDir = path.join(portableDir, 'locales');
  if (fs.existsSync(localesDir)) {
    fs.readdirSync(localesDir).forEach(f => {
      if (f !== 'zh-CN.pak') fs.rmSync(path.join(localesDir, f));
    });
  }

  // 确保 portable 目录的 exe 也有正确图标
  if (fs.existsSync(iconPath)) {
    await rcedit(path.join(portableDir, '片笺.exe'), { icon: iconPath });
    console.log('  portable 图标已设置');
  }

  // Step 4: 压缩为 zip
  console.log('[4/4] 压缩 zip...');
  const outPath = path.join(distDir, outName);
  if (fs.existsSync(outPath)) fs.rmSync(outPath);
  execSync(`"${sevenZip}" a -tzip -mx=9 "${outPath}" "${portableDir}"`, {
    stdio: 'inherit',
    cwd: distDir
  });

  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ 打包完成: ${outName} (${sizeMB} MB)`);
}

build().catch(err => {
  console.error('构建失败:', err);
  process.exit(1);
});
