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
  PANEL_WIDTH_KEY,
  loadPanelWidth,
  savePanelWidth,
  defaultPanelLayout,
  loadPanelLayout,
  savePanelLayout,
} = loadTs('src/renderer/src/native/panel/layout.ts');

test('PANEL_DEFAULT_WIDTH 初始默认宽度为 600px', () => {
  assert.equal(PANEL_DEFAULT_WIDTH, 600);
  assert.equal(PANEL_MIN_WIDTH, 240);
  assert.equal(PANEL_MAX_WIDTH, 720);
});

test('loadPanelWidth 在无记录时返回默认宽度 600px', () => {
  storage.clear();
  assert.equal(loadPanelWidth(), 600);
});

test('savePanelWidth 与 loadPanelWidth 正确存取并在合法区间内约束', () => {
  storage.clear();
  savePanelWidth(650);
  assert.equal(loadPanelWidth(), 650);
  assert.equal(storage.get(PANEL_WIDTH_KEY), '650');

  // 超出上限 720 截断
  savePanelWidth(800);
  assert.equal(loadPanelWidth(), 720);

  // 低于下限 240 截断
  savePanelWidth(150);
  assert.equal(loadPanelWidth(), 240);
});

test('loadPanelWidth 恢复老旧数据时将 500px 默认值平滑抬升至新默认 600px', () => {
  storage.clear();
  storage.set(PANEL_WIDTH_KEY, '500');
  assert.equal(loadPanelWidth(), 600);
});

test('defaultPanelLayout 采用当前全局面板宽度', () => {
  storage.clear();
  savePanelWidth(680);
  assert.equal(defaultPanelLayout().width, 680);
});

test('loadPanelLayout 跨会话统一保持全局面板宽度，页签内容保持会话独立', () => {
  storage.clear();
  // 用户在应用中全局调整宽度为 660px
  savePanelWidth(660);

  // 会话 1 有其专属页签与展开状态
  storage.set('qingwu.panel.layout.session-1', JSON.stringify({
    expanded: true,
    fullscreen: false,
    width: 500, // 旧数据里的会话宽度字段被全局统一宽度取代
    tabs: [{ id: 'tab-1', kind: 'guide' }],
    activeTabId: 'tab-1',
  }));

  // 会话 2 为全新会话
  const layout1 = loadPanelLayout('session-1');
  const layout2 = loadPanelLayout('session-2');

  // 面板宽度在所有会话中全局一致稳定（660px），不产生跳变
  assert.equal(layout1.width, 660);
  assert.equal(layout2.width, 660);

  // 会话独立的页签状态互不干扰
  assert.equal(layout1.expanded, true);
  assert.equal(layout1.tabs.length, 1);
  assert.equal(layout2.expanded, false);
  assert.equal(layout2.tabs.length, 0);
});

test('savePanelLayout 保证各会话独立状态互不干扰', () => {
  storage.clear();
  savePanelLayout('session-a', {
    expanded: true,
    fullscreen: false,
    width: 600,
    tabs: [{ id: 'files', kind: 'files' }],
    activeTabId: 'files',
  });

  savePanelLayout('session-b', {
    expanded: false,
    fullscreen: false,
    width: 600,
    tabs: [{ id: 'tab-b', kind: 'guide' }],
    activeTabId: 'tab-b',
  });

  const a = loadPanelLayout('session-a');
  const b = loadPanelLayout('session-b');
  assert.equal(a.expanded, true);
  assert.equal(a.tabs[0].kind, 'files');
  assert.equal(b.expanded, false);
  assert.equal(b.tabs[0].kind, 'guide');
});
