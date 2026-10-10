"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = { qingwu: {} };

const { loadTs } = require("./helpers/load-ts.cjs");

const {
  normalizePath,
  getDirectoryPath,
  isSameWorkspacePath,
} = loadTs("src/renderer/src/native/panel/workspace-files.ts", {
  "../rpc": { rpc: () => {}, toErrMsg: (e) => String(e) },
  "../protocol": { Endpoints: {} },
});

const { parseLocalFileLink } = loadTs("src/renderer/src/native/markdown.tsx", {
  react: { createContext: () => ({ Provider: () => null }), memo: (c) => c, useContext: () => ({}), useEffect: () => {}, useMemo: (fn) => fn(), useState: (v) => [v, () => {}] },
  "../i18n": { useT: () => (k) => k },
  "react-markdown": () => null,
  "remark-gfm": () => null,
  "./panel/workspace-files": { normalizePath },
});

test("normalizePath 与 getDirectoryPath 能够正确规范化路径并提取父目录", () => {
  // 消除 . 与 ..
  assert.equal(
    normalizePath("D:/code/qingwu/docs/../docs/tech.md"),
    "D:\\code\\qingwu\\docs\\tech.md"
  );
  assert.equal(
    normalizePath("docs/sub/../tech.md"),
    "docs/tech.md"
  );
  assert.equal(
    normalizePath("D:\\code\\docs\\sub\\..\\..\\README.md"),
    "D:\\code\\README.md"
  );

  // 盘符大写
  assert.equal(
    normalizePath("c:\\workspace\\project\\test.md"),
    "C:\\workspace\\project\\test.md"
  );

  // 父目录提取
  assert.equal(
    getDirectoryPath("D:\\code\\qingwu\\docs\\tech.md"),
    "D:\\code\\qingwu\\docs"
  );
  assert.equal(
    getDirectoryPath("docs/desktop/index.md"),
    "docs/desktop"
  );
  assert.equal(
    getDirectoryPath("README.md"),
    ""
  );
});

test("isSameWorkspacePath 能够跨相对/绝对/斜杠/大小写准确判定同一文件", () => {
  const cwd = "D:\\code\\qingwu";

  // 相对路径 vs 绝对路径
  assert.equal(
    isSameWorkspacePath("docs/tech.md", "D:\\code\\qingwu\\docs\\tech.md", cwd),
    true
  );

  // 包含 .. 规约段 vs 规约后路径
  assert.equal(
    isSameWorkspacePath("docs/desktop/../tech.md", "D:/code/qingwu/docs/tech.md", cwd),
    true
  );

  // 斜杠差异与大小写差异 (Windows)
  assert.equal(
    isSameWorkspacePath("DOCS/TECH.MD", "docs\\tech.md", cwd),
    true
  );

  // 不同文件
  assert.equal(
    isSameWorkspacePath("docs/tech.md", "docs/other.md", cwd),
    false
  );
});

test("parseLocalFileLink 解析 Markdown 文档链接", () => {
  const cwd = "D:\\code\\qingwu";
  const docDir = "D:\\code\\qingwu\\docs\\desktop";

  // 1. 网络协议一律返回 null（保持由浏览器打开）
  assert.equal(parseLocalFileLink("https://github.com/deepseek-ai/dsh", cwd, docDir), null);
  assert.equal(parseLocalFileLink("http://example.com/test.md", cwd, docDir), null);
  assert.equal(parseLocalFileLink("mailto:test@example.com", cwd, docDir), null);

  // 2. 纯页内锚点返回 null
  assert.equal(parseLocalFileLink("#section-1", cwd, docDir), null);
  assert.equal(parseLocalFileLink("#heading", cwd, docDir), null);

  // 3. 相对当前文档目录解析（优先 baseDir）
  const subDoc = parseLocalFileLink("./sub/detail.md", cwd, docDir);
  assert.equal(subDoc.path, "D:\\code\\qingwu\\docs\\desktop\\sub\\detail.md");
  assert.equal(subDoc.line, undefined);

  // 4. 上级相对路径（含 .. 规约）
  const parentDoc = parseLocalFileLink("../tech-architecture.md", cwd, docDir);
  assert.equal(parentDoc.path, "D:\\code\\qingwu\\docs\\tech-architecture.md");

  // 5. 带有 #L 行号锚点
  const anchorLink = parseLocalFileLink("../tech-architecture.md#L42", cwd, docDir);
  assert.equal(anchorLink.path, "D:\\code\\qingwu\\docs\\tech-architecture.md");
  assert.equal(anchorLink.line, 42);

  // 6. 范围行号锚点 #L10-L20
  const rangeLink = parseLocalFileLink("helper.ts#L10-L20", cwd, docDir);
  assert.equal(rangeLink.path, "D:\\code\\qingwu\\docs\\desktop\\helper.ts");
  assert.equal(rangeLink.line, 10);

  // 7. 根路径开头（/docs/... 相对 cwd）
  const rootRel = parseLocalFileLink("/docs/TODO.md", cwd, docDir);
  assert.equal(rootRel.path, "D:\\code\\qingwu\\docs\\TODO.md");

  // 8. 绝对路径原样规范化
  const absLink = parseLocalFileLink("d:/other/file.md", cwd, docDir);
  assert.equal(absLink.path, "D:\\other\\file.md");

  // 9. 无 baseDir 时回退到 cwd
  const fallback = parseLocalFileLink("src/index.ts", cwd, null);
  assert.equal(fallback.path, "D:\\code\\qingwu\\src\\index.ts");
});
