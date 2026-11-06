'use strict';

// 真实 NSIS 回归仅操作本次创建的测试目录与独立应用标识。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');
const { getMakeNsisPath, getNsisPluginsPath } = require('app-builder-lib/out/toolsets/windows');
const { parsePatch, reversePatch, applyPatch } = require('diff');
const { UUID } = require('builder-util-runtime');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
const LONG_FILE = 'resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools/models/issues_manager/descriptions/selectElementAccessibilityInteractiveContentAttributesSelectDescendant.md';
const REPLAY_FILE = LONG_FILE.slice('resources/app.asar.unpacked/'.length);

function run(exe, args = [], options = {}) {
  const result = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', timeout: 120000, ...options });
  assert.ifError(result.error);
  return result;
}

function write(file, data = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function quoted(file) {
  return file.replaceAll('$', '$$').replaceAll('"', '$\\"');
}

test('真实 NSIS 长路径迁移、回滚和旧安装兼容升级', { skip: process.platform !== 'win32', timeout: 600000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-nsis-'));
  const compiler = await getMakeNsisPath();
  const plugins = await getNsisPluginsPath();
  const source = fs.readFileSync(path.join(TEMPLATE, 'uninstaller.nsh'), 'utf8').replaceAll('\r\n', '\n');
  const patch = parsePatch(fs.readFileSync(path.join(ROOT, 'patches/app-builder-lib+26.18.0.patch'), 'utf8'))
    .find((item) => item.oldFileName.endsWith('/uninstaller.nsh'));
  const legacy = applyPatch(source, reversePatch(patch));
  assert.ok(legacy, '应能从版本化补丁还原已部署的原始卸载源码');

  function compile(name, script) {
    const file = path.join(tmp, name + '.nsi');
    const exe = path.join(tmp, name + '.exe');
    write(file, `Unicode true\nRequestExecutionLevel user\nSilentInstall silent\nOutFile "${quoted(exe)}"\n!include LogicLib.nsh\n${script}`);
    const result = run(compiler.path, ['-V2', '-INPUTCHARSET', 'UTF8', file], { env: { ...process.env, ...compiler.env } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return exe;
  }

  function functions(text) {
    return text.slice(text.indexOf('Function un.atomicRMDir'), text.indexOf('!ifndef UNINSTALL_SECTION_NAME'))
      .replaceAll('un.atomicRMDir', 'atomicRMDir').replaceAll('un.restoreFiles', 'restoreFiles')
      .replaceAll('$PLUGINSDIR', '$backup');
  }

  async function replay(name, text, destinationLength, locked = false) {
    const installed = path.join(tmp, name);
    const relative = REPLAY_FILE.replaceAll('/', '\\');
    const backup = path.join(tmp, 'b-' + name);
    const targetRoot = backup + '\\' + 'x'.repeat(Math.max(1, destinationLength - backup.length - relative.length - 2));
    write(path.join(installed, REPLAY_FILE), '长路径文件内容');
    write(path.join(installed, 'a-first.txt'), '先移动，再回滚');
    if (locked) write(path.join(installed, 'z-locked.txt'), '锁定内容');
    const log = path.join(tmp, name + '.txt');
    const exe = compile(name, `
!define UNINSTALL_FILENAME "Uninstall fixture.exe"
Var backup
Var log
${functions(text)}
Section
StrCpy $INSTDIR "${quoted(installed)}"
StrCpy $backup "${quoted(targetRoot)}"
CreateDirectory "\\\\?\\$backup\\old-install"
${locked ? `System::Call 'kernel32::CreateFileW(w "$INSTDIR\\z-locked.txt", i 0x80000000, i 1, p 0, i 3, i 0, p 0) p.r8'` : ''}
Push ""
Call atomicRMDir
Pop $R0
FileOpen $log "${quoted(log)}" w
FileWrite $log "$R0$\\r$\\n"
${locked ? `Push ""\nCall restoreFiles\nPop $R0\nFileWrite $log "$R0$\\r$\\n"\nSystem::Call 'kernel32::CloseHandle(p r8)'` : ''}
FileClose $log
SectionEnd`);
    const result = run(exe);
    assert.equal(result.status, 0, result.stderr);
    return { installed, target: path.join(targetRoot, 'old-install', REPLAY_FILE), lines: fs.readFileSync(log, 'utf8').trim().split(/\r?\n/) };
  }

  await t.test('原始卸载代码在迁移目标达到 260 字符时失败', async () => {
    const result = await replay('legacy', legacy, 260 - '\\old-install'.length);
    assert.equal(result.target.length, 260);
    assert.notEqual(result.lines[0], '0');
    assert.equal(fs.readFileSync(path.join(result.installed, REPLAY_FILE), 'utf8'), '长路径文件内容');
  });

  for (const length of [259, 260, 320]) {
    await t.test(`修正版迁移目标 ${length} 字符成功`, async () => {
      const result = await replay('fixed-' + length, source, length - '\\old-install'.length);
      assert.equal(result.target.length, length);
      assert.equal(result.lines[0], '0');
      assert.equal(fs.readFileSync(result.target, 'utf8'), '长路径文件内容');
      assert.equal(fs.existsSync(path.join(result.installed, REPLAY_FILE)), false);
    });
  }

  await t.test('长文件移动后遇到占用，完整恢复此前已移动文件', async () => {
    const result = await replay('locked', source, 320 - '\\old-install'.length, true);
    assert.match(result.lines[0], /z-locked\.txt/);
    assert.equal(result.lines[1], '0');
    assert.equal(fs.readFileSync(path.join(result.installed, REPLAY_FILE), 'utf8'), '长路径文件内容');
    assert.equal(fs.readFileSync(path.join(result.installed, 'a-first.txt'), 'utf8'), '先移动，再回滚');
    assert.equal(fs.readFileSync(path.join(result.installed, 'z-locked.txt'), 'utf8'), '锁定内容');
  });

  await t.test('UAC 插件固定后释放模块仍保留回调代码', async () => {
    const log = path.join(tmp, 'uac.txt');
    const exe = compile('pin-uac', `
!addplugindir /x86-unicode "${quoted(path.join(plugins, 'x86-unicode'))}"
!include "${quoted(path.join(TEMPLATE, 'include/UAC.nsh'))}"
Section
!insertmacro QW_UAC_PinModule
System::Call 'kernel32::GetModuleHandleW(w "$PLUGINSDIR\\UAC.dll") p.r0'
System::Call 'kernel32::FreeLibrary(p r0)'
System::Call 'kernel32::FreeLibrary(p r0)'
System::Call 'kernel32::GetModuleHandleW(w "$PLUGINSDIR\\UAC.dll") p.r1'
FileOpen $2 "${quoted(log)}" w
FileWrite $2 "$0,$1"
FileClose $2
SectionEnd`);
    const result = run(exe);
    assert.equal(result.status, 0);
    const [before, after] = fs.readFileSync(log, 'utf8').split(',');
    assert.notEqual(before, '0');
    assert.equal(after, before);
  });

  await t.test('新安装器升级存量旧卸载器，再升级修复版，并正常卸载', async (subtest) => {
    const fixtureId = 'com.qingwu.installer-test.' + path.basename(tmp);
    const packed = path.join(tmp, 'packed');
    const installed = path.join(tmp, 'app');
    const output = path.join(tmp, 'dist');
    const userData = path.join(process.env.APPDATA, fixtureId);
    const guid = UUID.v5(fixtureId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
    subtest.after(() => {
      // 注册表键由本次随机测试标识推导，绝不枚举或移除真实应用条目。
      run('reg.exe', ['delete', `HKCU\\Software\\${guid}`, '/f', '/reg:64']);
      run('reg.exe', ['delete', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`, '/f', '/reg:64']);
      if (fs.existsSync(path.join(userData, 'session-marker.txt'))) fs.unlinkSync(path.join(userData, 'session-marker.txt'));
      if (fs.existsSync(userData)) fs.rmdirSync(userData);
    });
    write(path.join(userData, 'session-marker.txt'), '升级与卸载保留测试会话');
    const config = {
      appId: fixtureId,
      productName: 'Qingwu Installer Test',
      directories: { output },
      beforePack: null,
      publish: null,
      win: { executableName: 'qingwu-installer-test', target: 'nsis' },
      nsis: {
        oneClick: false, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: false, createStartMenuShortcut: false,
        runAfterFinish: false, artifactName: 'fixture-${version}.exe',
      },
    };
    write(path.join(packed, LONG_FILE), '完整升级保留路径');
    write(path.join(packed, 'qingwu-installer-test.exe'), '测试入口标记');
    write(path.join(packed, 'resources/app-update.yml'), 'provider: generic\nurl: https://example.invalid\n');
    for (const version of ['0.3.2', '0.3.3']) {
      config.extraMetadata = { version, name: fixtureId, productName: 'Qingwu Installer Test ' + path.basename(tmp) };
      await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), prepackaged: packed, config, publish: 'never' });
    }
    const env = { ...process.env };
    const first = run(path.join(output, 'fixture-0.3.2.exe'), ['/S', '/currentuser', `/D=${installed}`], { env });
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.ok(fs.existsSync(path.join(installed, LONG_FILE)));
    // 放入一个一旦执行便返回 2 的旧卸载器，明确验证首次兼容升级没有执行它。
    const oldUninstaller = compile('old-uninstaller', 'Section\nSetErrorLevel 2\nSectionEnd');
    const installedUninstaller = path.join(installed, fs.readdirSync(installed).find((name) => /^Uninstall .+\.exe$/i.test(name)) || 'missing-uninstaller');
    assert.ok(fs.existsSync(installedUninstaller));
    fs.copyFileSync(oldUninstaller, installedUninstaller);
    const updated = run(path.join(output, 'fixture-0.3.3.exe'), ['/S', '/currentuser', `/D=${installed}`], { env });
    assert.equal(updated.status, 0, updated.stdout + updated.stderr);
    assert.equal(fs.readFileSync(path.join(installed, LONG_FILE), 'utf8'), '完整升级保留路径');
    assert.equal(fs.readFileSync(path.join(userData, 'session-marker.txt'), 'utf8'), '升级与卸载保留测试会话');
    const next = run(path.join(output, 'fixture-0.3.3.exe'), ['/S', '/currentuser', `/D=${installed}`], { env });
    assert.equal(next.status, 0, next.stdout + next.stderr);
    // _?= 防止自复制启动后父进程过早返回，确保等待真正卸载完成。
    const finalUninstaller = path.join(tmp, 'final-uninstaller.exe');
    fs.copyFileSync(installedUninstaller, finalUninstaller);
    const uninstalled = run(finalUninstaller, ['/S', '/currentuser', `_?=${installed}`], { env });
    assert.equal(uninstalled.status, 0, uninstalled.stdout + uninstalled.stderr);
    assert.equal(fs.existsSync(path.join(installed, LONG_FILE)), false);
    assert.equal(fs.existsSync(installed), false);
    assert.equal(fs.readFileSync(path.join(userData, 'session-marker.txt'), 'utf8'), '升级与卸载保留测试会话');
    fs.unlinkSync(path.join(userData, 'session-marker.txt'));
    fs.rmdirSync(userData);
  });

  // 仅删除本测试创建的绝对路径。
  assert.equal(path.dirname(tmp), os.tmpdir());
  fs.rmSync(tmp, { recursive: true, force: true });
});
