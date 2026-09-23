'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

const { getMenuItems } = loadTs('src/shared/menu-data.ts');

test('菜单数据：各菜单项分类与结构完备性（对齐 ChatGPT）', () => {
  const fileItems = getMenuItems('文件', { uiMode: 'native' });
  assert.ok(fileItems.some((item) => item.id === 'reload' && item.accelerator === 'Ctrl+R'));
  assert.ok(fileItems.some((item) => item.id === 'openTerminal'));
  assert.ok(fileItems.some((item) => item.id === 'quit'));
  assert.equal(fileItems.some((item) => item.id === 'toggleCloseToTray'), false);

  const editItems = getMenuItems('编辑', { uiMode: 'native' });
  assert.ok(editItems.some((item) => item.id === 'undo' && item.accelerator === 'Ctrl+Z'));
  assert.ok(editItems.some((item) => item.id === 'redo' && item.accelerator === 'Ctrl+Y'));
  assert.ok(editItems.some((item) => item.id === 'cut' && item.accelerator === 'Ctrl+X'));
  assert.ok(editItems.some((item) => item.id === 'copy' && item.accelerator === 'Ctrl+C'));
  assert.ok(editItems.some((item) => item.id === 'paste' && item.accelerator === 'Ctrl+V'));
  assert.ok(editItems.some((item) => item.id === 'selectAll' && item.accelerator === 'Ctrl+A'));
  assert.ok(editItems.some((item) => item.id === 'settings' && item.accelerator === 'Ctrl+,'));

  const viewItems = getMenuItems('视图', { uiMode: 'native' });
  assert.ok(viewItems.some((item) => item.id === 'toggleFullScreen' && item.accelerator === 'F11'));
  assert.ok(viewItems.some((item) => item.id === 'toggleDevTools' && item.accelerator === 'F12'));

  const helpItems = getMenuItems('帮助', { uiMode: 'native' });
  assert.ok(helpItems.some((item) => item.id === 'checkForUpdates'));
  assert.ok(helpItems.some((item) => item.id === 'about'));
});

test('菜单数据：uiMode 文案动态联动', () => {
  const viewNative = getMenuItems('视图', { uiMode: 'native' });
  const switchNative = viewNative.find((item) => item.id === 'switchUiMode');
  assert.equal(switchNative?.label, '切换到 DeepSeek 界面');

  const viewOfficial = getMenuItems('视图', { uiMode: 'official' });
  const switchOfficial = viewOfficial.find((item) => item.id === 'switchUiMode');
  assert.equal(switchOfficial?.label, '切换到青梧界面');
});
