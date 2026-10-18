'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

// Mock localStorage
const storage = new Map();
global.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  },
};

const {
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_DEFAULT_WIDTH,
  defaultPanelLayout,
  loadPanelLayout,
  savePanelLayout,
} = loadTs('src/renderer/src/native/panel/layout.ts');

test('PANEL_DEFAULT_WIDTH 初始默认宽度为 600px', () => {
  assert.equal(PANEL_DEFAULT_WIDTH, 600);
  assert.equal(PANEL_MIN_WIDTH, 240);
  assert.equal(PANEL_MAX_WIDTH, 720);
});

test('defaultPanelLayout 默认宽度为 600px', () => {
  assert.equal(defaultPanelLayout().width, 600);
});

test('loadPanelLayout 在无会话记录或无保存宽度时返回默认宽度 600px', () => {
  storage.clear();

  // 无记录会话
  const layoutNew = loadPanelLayout('session-new');
  assert.equal(layoutNew.width, 600);

  // 记录存在但无 width 字段
  storage.set('qingwu.panel.layout.session-no-width', JSON.stringify({
    expanded: true,
    fullscreen: false,
    tabs: [],
    activeTabId: null,
  }));
  const layoutNoWidth = loadPanelLayout('session-no-width');
  assert.equal(layoutNoWidth.width, 600);
});

test('loadPanelLayout 恢复老旧数据时将 500px 默认值平滑抬升至新默认 600px', () => {
  storage.clear();
  storage.set('qingwu.panel.layout.session-old', JSON.stringify({
    expanded: true,
    fullscreen: false,
    width: 500,
    tabs: [],
    activeTabId: null,
  }));
  const layout = loadPanelLayout('session-old');
  assert.equal(layout.width, 600);
});

test('loadPanelLayout 保留用户主动保存的 600px 以下有效宽度', () => {
  storage.clear();
  // 用户主动将宽度调整到 550px
  storage.set('qingwu.panel.layout.session-custom-narrow', JSON.stringify({
    expanded: true,
    fullscreen: false,
    width: 550,
    tabs: [],
    activeTabId: null,
  }));
  const layout = loadPanelLayout('session-custom-narrow');
  assert.equal(layout.width, 550);
});

test('loadPanelLayout 保留用户主动保存的宽面板数值并约束超界值', () => {
  storage.clear();
  // 688px 正常保留
  storage.set('qingwu.panel.layout.session-wide', JSON.stringify({
    expanded: true,
    fullscreen: false,
    width: 688,
    tabs: [],
    activeTabId: null,
  }));
  assert.equal(loadPanelLayout('session-wide').width, 688);

  // 超出上限 720 截断
  storage.set('qingwu.panel.layout.session-over', JSON.stringify({
    expanded: true,
    fullscreen: false,
    width: 900,
    tabs: [],
    activeTabId: null,
  }));
  assert.equal(loadPanelLayout('session-over').width, 720);

  // 低于下限 240 截断
  storage.set('qingwu.panel.layout.session-under', JSON.stringify({
    expanded: true,
    fullscreen: false,
    width: 100,
    tabs: [],
    activeTabId: null,
  }));
  assert.equal(loadPanelLayout('session-under').width, 240);
});

test('savePanelLayout 保证各会话宽度独立存储互不干扰', () => {
  storage.clear();
  savePanelLayout('session-1', {
    expanded: true,
    fullscreen: false,
    width: 650,
    tabs: [],
    activeTabId: null,
  });

  savePanelLayout('session-2', {
    expanded: false,
    fullscreen: false,
    width: 550,
    tabs: [],
    activeTabId: null,
  });

  assert.equal(loadPanelLayout('session-1').width, 650);
  assert.equal(loadPanelLayout('session-2').width, 550);
});
