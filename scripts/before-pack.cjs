'use strict';

const { ensureNodeRuntime } = require('./fetch-node-runtime.cjs');

/**
 * electron-builder 打包前钩子：确保随包发行的 Node 运行时已就绪。
 *
 * 这里失败必须让打包失败——否则会静默产出「引擎退回 Electron 运行时、
 * Agent 执行命令又闪控制台窗口」的安装包。确需跳过时用
 * QW_SKIP_NODE_RUNTIME=1（仅用于排查打包问题）。
 */
module.exports = async function beforePack() {
  if (process.env.QW_SKIP_NODE_RUNTIME === '1') {
    console.warn(
      '[before-pack] 已按 QW_SKIP_NODE_RUNTIME=1 跳过 Node 运行时准备：' +
        '引擎将退回 Electron 运行时，Agent 执行命令会闪控制台窗口。'
    );
    return;
  }
  await ensureNodeRuntime();
};
