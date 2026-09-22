"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { loadTs } = require("./helpers/load-ts.cjs");

test("resolveTargetPath 能够正确解析目录、文件父目录和 fallback", () => {
  const homeFixture = "C:\\fixture\\home";
  const {
    resolveTargetPath,
    setActiveWorkspacePath,
    getActiveWorkspacePath,
  } = loadTs("src/main/terminal.ts", {
    electron: {
      app: {
        getPath: (name) => (name === "home" ? homeFixture : "C:\\fixture"),
      },
      shell: {},
    },
  });

  // 1. 未传入任何值，且无 activeWorkspace 时，回退到 home
  assert.equal(resolveTargetPath(), homeFixture);
  assert.equal(resolveTargetPath(null), homeFixture);

  // 2. 设置 activeWorkspacePath
  setActiveWorkspacePath(process.cwd());
  assert.equal(getActiveWorkspacePath(), process.cwd());
  assert.equal(resolveTargetPath(), process.cwd());

  // 3. 传入存在目录时，直接使用该目录
  assert.equal(resolveTargetPath(process.cwd()), process.cwd());

  // 4. 传入文件时，解析为其所在目录
  const packageJson = path.join(process.cwd(), "package.json");
  assert.equal(resolveTargetPath(packageJson), process.cwd());
});

test("resolveFileOrDirectory 能够保留原文件路径并正确结合 activeWorkspace", () => {
  let shownPath = null;
  const homeFixture = "C:\\fixture\\home";
  const {
    resolveFileOrDirectory,
    showItemInFolder,
    setActiveWorkspacePath,
  } = loadTs("src/main/terminal.ts", {
    electron: {
      app: {
        getPath: (name) => (name === "home" ? homeFixture : "C:\\fixture"),
      },
      shell: {
        showItemInFolder: (p) => {
          shownPath = p;
        },
      },
    },
  });

  setActiveWorkspacePath(process.cwd());

  // 相对路径解析为基于工作区的绝对路径，且保留文件本身
  const relativeFile = "package.json";
  const expectedFull = path.resolve(process.cwd(), relativeFile);
  assert.equal(resolveFileOrDirectory(relativeFile), expectedFull);

  // showItemInFolder 会将目标路径定位到文件管理器
  showItemInFolder(relativeFile);
  assert.equal(shownPath, expectedFull);
});
