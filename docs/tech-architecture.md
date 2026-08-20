# 青梧 技术路线与架构决策

记录青梧已确定的技术路线、架构分层与关键决策。改动前先读本文。

## 技术栈（已定）

- Electron：桌面壳。DeepSeek Harness 本身是 Node.js / TypeScript 技术栈，Electron 自带 Node 与 Chromium，天然吻合；不选 Tauri，避免凭空增加 Rust 与 Node sidecar 管理复杂度。
- @deepseek-ai/dsh：DeepSeek Harness CLI / 运行时，作为 npm 依赖随应用打包并锁定版本，用户无需单独安装。
- 打包：electron-builder / NSIS，产出 Windows 安装包。

## 分层（V1）

```
我们自己的 UI（后续按轮次替换）
        ↓ 加载 / 替换
官方 dsh web UI（V1 直接使用）
        ↓ 本地服务
Harness 引擎（Agent / Session / Tools / LLM / Sandbox / Skills）
```

## 关键决策

1. 引擎随包内置并锁定版本：App 锁定某个 dsh 版本，测试确认后再发布；不依赖用户环境的全局安装，避免版本不一致问题。dsh 当前快速迭代，升级需单独验证。
2. 不合并源码：Harness 作为依赖使用，不 fork 进本仓库，保持引擎与产品代码独立。
3. 运行方式：以 ELECTRON_RUN_AS_NODE=1 运行 dsh 的 CLI 入口（lib/bin.js），避免依赖 .bin 脚本在打包后的路径问题。
4. 端口：dsh web 默认 127.0.0.1:3080；V1 直接使用，后续做设置页再改为可配置。
5. 与引擎的抽象边界：UI 与引擎之间保持抽象，不把界面代码直接长在 Harness 内部 API 上，为后续换引擎保留可能。

## 已核实项（V0.0.1 验证结论）

1. **端口与参数支持**：已验证 dsh web 支持 `--port <port>`（传 0 可由系统自动分配）、`--host <host>` 以及 `--no-open`（禁止自动唤起外部默认浏览器）。
2. **依赖与打包机制**：Harness 及其配套插件包通过 npm dependencies 内置；打包配置使用 `asarUnpack: ["node_modules/**"]`，在生产环境以 `ELECTRON_RUN_AS_NODE=1` 及 `--expose-internals` 启动，完整兼容所有原生预编译模块（koffi、node-pty）。
3. **Profile 初始化与系统兼容**：dsh 内置 healProfilesModuleFallback 软链机制；已落地 Windows 下 Directory Junction 的安全解除与更新补丁（scripts/patch-dsh.js），无需用户手动介入。
