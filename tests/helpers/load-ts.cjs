"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../..");

/** 测试直接加载项目 TypeScript；独立缓存和依赖替身避免启动 Electron 或引擎。 */
function loadTs(relativePath, mocks = {}) {
  const cache = new Map();

  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = new Module(filename);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, loaded);
    const nativeRequire = Module.createRequire(filename);
    loaded.require = (specifier) => {
      if (Object.prototype.hasOwnProperty.call(mocks, specifier))
        return mocks[specifier];
      if (specifier.startsWith(".")) {
        const base = path.resolve(path.dirname(filename), specifier);
        const candidates = [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          path.join(base, "index.ts"),
        ];
        const source = candidates.find(
          (candidate) =>
            /\.tsx?$/.test(candidate) &&
            fs.existsSync(candidate) &&
            fs.statSync(candidate).isFile(),
        );
        if (source) return load(source);
      }
      return nativeRequire(specifier);
    };
    const { outputText } = ts.transpileModule(
      fs.readFileSync(filename, "utf8"),
      {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      },
    );
    loaded._compile(outputText, filename);
    loaded.loaded = true;
    return loaded.exports;
  }

  return load(path.resolve(ROOT, relativePath));
}

module.exports = { loadTs };
