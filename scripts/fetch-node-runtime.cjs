'use strict';

/**
 * 准备随包发行的官方 Node 运行时（控制台子系统）。
 *
 * 为什么需要它：主进程与 electron.exe 都是 GUI 子系统程序，而 GUI 进程不继承
 * 父进程的控制台；dsh 又用 process.execPath 逐层派生 Windows Job runner 与
 * windows-acl runner，于是整条链都没有控制台，Agent 每执行一条命令，
 * 控制台子系统的 pwsh 就会自己新建一个可见控制台窗口（不断闪黑窗）。
 * 换成控制台子系统的 node.exe 启动引擎后，整棵树都继承主进程那个隐藏控制台
 * （见 docs/tech-architecture.md「引擎运行方式」）。
 *
 * 版本固定为与 Electron 内置 Node 相同的版本，避免双运行时行为漂移；
 * 下载后按官方 SHASUMS256.txt 校验，解出 node.exe 到 build/node-runtime/
 * （该目录不入库，由 npm run runtime:node 或打包前钩子生成）。
 */

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** 与 Electron 43.4.1 内置的 Node 版本对齐；升级 Electron 时同步更新这里。 */
const NODE_VERSION = '24.18.1';
const PLATFORM = 'win-x64';
const DIST_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;
const ZIP_NAME = `node-v${NODE_VERSION}-${PLATFORM}.zip`;
const MEMBER = `node-v${NODE_VERSION}-${PLATFORM}/node.exe`;

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'build', 'node-runtime');
const RUNTIME_EXE = path.join(RUNTIME_DIR, 'node.exe');
const ZIP_PATH = path.join(RUNTIME_DIR, ZIP_NAME);

function log(message) {
  console.log(`[node-runtime] ${message}`);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 读取一个可执行文件自报的版本；不可执行时返回 null。 */
function runtimeVersion(exe) {
  try {
    return execFileSync(exe, ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function download(url, file) {
  log(`下载 ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status} ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file, buffer);
  log(`已保存 ${path.relative(ROOT, file)}（${(buffer.length / 1024 / 1024).toFixed(1)} MB）`);
}

/** 按官方 SHASUMS256.txt 校验压缩包。 */
async function verifyZip(file) {
  const response = await fetch(`${DIST_BASE}/SHASUMS256.txt`);
  if (!response.ok) {
    throw new Error(`获取 SHASUMS256.txt 失败: HTTP ${response.status}`);
  }
  const text = await response.text();
  const line = text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith(`  ${ZIP_NAME}`));
  if (!line) throw new Error(`SHASUMS256.txt 中找不到 ${ZIP_NAME}`);
  const expected = line.split(/\s+/)[0];
  const actual = sha256(file);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 校验失败: ${ZIP_NAME}\n  期望 ${expected}\n  实际 ${actual}`
    );
  }
  log(`SHA-256 校验通过: ${ZIP_NAME}`);
}

/** 从压缩包中解出 node.exe（优先 bsdtar，失败回退 PowerShell Expand-Archive）。 */
function extractNodeExe() {
  const staging = path.join(RUNTIME_DIR, 'extract');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    execFileSync('tar', ['-xf', ZIP_PATH, '-C', staging, MEMBER], { stdio: 'inherit' });
  } catch (error) {
    log(`tar 解压失败，回退 PowerShell Expand-Archive: ${error.message}`);
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${ZIP_PATH}' -DestinationPath '${staging}' -Force`,
      ],
      { stdio: 'inherit' }
    );
  }
  const extracted = path.join(staging, ...MEMBER.split('/'));
  if (!fs.existsSync(extracted)) {
    throw new Error(`压缩包中未找到 ${MEMBER}`);
  }
  fs.copyFileSync(extracted, RUNTIME_EXE);
  fs.rmSync(staging, { recursive: true, force: true });
  log(`已就绪 ${path.relative(ROOT, RUNTIME_EXE)}`);
}

/**
 * 确保 build/node-runtime/node.exe 存在且版本正确（幂等）。
 * @returns {Promise<string>} node.exe 的绝对路径
 */
async function ensureNodeRuntime() {
  if (process.platform !== 'win32') {
    log(`当前平台 ${process.platform} 无需准备 Windows 运行时，跳过`);
    return RUNTIME_EXE;
  }

  const current = fs.existsSync(RUNTIME_EXE) ? runtimeVersion(RUNTIME_EXE) : null;
  if (current === `v${NODE_VERSION}`) {
    log(`已存在且版本匹配: ${path.relative(ROOT, RUNTIME_EXE)}（${current}）`);
    return RUNTIME_EXE;
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const zipReady = fs.existsSync(ZIP_PATH);
  if (zipReady) {
    try {
      await verifyZip(ZIP_PATH);
    } catch (error) {
      log(`缓存压缩包不可用，重新下载: ${error.message}`);
      fs.rmSync(ZIP_PATH, { force: true });
    }
  }
  if (!fs.existsSync(ZIP_PATH)) {
    await download(`${DIST_BASE}/${ZIP_NAME}`, ZIP_PATH);
    await verifyZip(ZIP_PATH);
  }

  extractNodeExe();
  const extractedVersion = runtimeVersion(RUNTIME_EXE);
  if (extractedVersion !== `v${NODE_VERSION}`) {
    throw new Error(
      `解出的 node.exe 版本不符: 期望 v${NODE_VERSION}，实际 ${extractedVersion ?? '无法执行'}`
    );
  }
  return RUNTIME_EXE;
}

module.exports = { ensureNodeRuntime, NODE_VERSION, RUNTIME_EXE };

if (require.main === module) {
  ensureNodeRuntime().catch((error) => {
    console.error(`[node-runtime] 准备失败: ${error.message}`);
    process.exit(1);
  });
}
