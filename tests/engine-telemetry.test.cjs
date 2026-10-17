'use strict';

// 遥测禁用与依赖裁剪的配套契约：
// 引擎遥测由 telemetry-off.patch.yml（经 --patch 注入）禁用，安装包随之
// 排除 OpenTelemetry 依赖；三处配置任何一处被单独改动，都会回到
// 「插件加载缺依赖」或「包裁了却没禁用」的错配状态，本测试负责拦住。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** 裁剪的遥测依赖（打包 files 必须全部排除）。 */
const EXCLUDED_PACKAGES = [
  '@opentelemetry',
  '@deepseek-ai/dsh-otel',
  '@deepseek-ai/dsh-session-telemetry-otel',
  '@deepseek-ai/dsh-host-product-telemetry-otel',
  '@deepseek-ai/dsh-client-product-analytics',
];

/** 补丁必须禁用的引擎插件行（缺一则对应包会被加载而缺依赖）。 */
const PATCH_ROWS = ['- id: otel\n  disabled: true', '- id: session-telemetry-otel\n  disabled: true'];

test('遥测禁用补丁存在且禁用行完整', () => {
  const patchPath = path.join(root, 'build', 'telemetry-off.patch.yml');
  // 归一化行尾：CI 检出可能把 LF 转 CRLF，断言只关心行内容本身
  const content = fs.readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n');
  for (const row of PATCH_ROWS) {
    assert.ok(content.includes(row), `补丁缺少禁用行: ${row}`);
  }
});

test('打包配置排除全部遥测依赖并随包分发补丁', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = pkg.build.files;
  for (const name of EXCLUDED_PACKAGES) {
    const pattern = `!**/node_modules/${name}/**`;
    assert.ok(files.includes(pattern), `build.files 缺少排除规则: ${pattern}`);
  }
  const extra = pkg.build.extraResources ?? [];
  assert.ok(
    extra.some((entry) => entry.from === 'build/telemetry-off.patch.yml'),
    'extraResources 必须随包分发遥测禁用补丁',
  );
});

test('主进程启动接线包含补丁注入与遥测环境变量', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'harness.ts'), 'utf8');
  assert.ok(source.includes('"--patch"'), '引擎启动参数必须注入 --patch');
  assert.ok(source.includes('DSH_TELEMETRY_DISABLED'), '引擎环境必须设置 DSH_TELEMETRY_DISABLED');
  assert.ok(
    source.includes('telemetry-off.patch.yml'),
    '补丁路径解析必须指向 telemetry-off.patch.yml',
  );
});
