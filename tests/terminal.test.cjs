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
