# 青梧 技术路线与架构决策

记录青梧已确定的技术路线、架构分层与关键决策。改动前先读本文。

## 技术栈（已定）

- Electron：桌面壳。DeepSeek Harness 本身是 Node.js / TypeScript 技术栈，Electron 自带 Node 与 Chromium，天然吻合；不选 Tauri，避免凭空增加 Rust 与 Node sidecar 管理复杂度。
- @deepseek-ai/dsh：DeepSeek Harness CLI / 运行时，作为 npm 依赖随应用打包并锁定版本，用户无需单独安装。
- 打包：electron-builder / NSIS，产出 Windows 安装包。

## 分层（当前）

```
我们自己的 UI（后续按轮次替换）
        ↓ 加载 / 替换
官方 dsh web UI（当前直接使用）
        ↓ 本地服务
Harness 引擎（Agent / Session / Tools / LLM / Sandbox / Skills）
```

## 关键决策

1. 引擎随包内置并锁定版本：App 锁定某个 dsh 版本，测试确认后再发布；不依赖用户环境的全局安装，避免版本不一致问题。dsh 当前快速迭代，升级需单独验证。
2. 不合并源码：Harness 作为依赖使用，不 fork 进本仓库，保持引擎与产品代码独立。
3. 运行方式：以 ELECTRON_RUN_AS_NODE=1 运行 dsh 的 CLI 入口（lib/bin.js），避免依赖 .bin 脚本在打包后的路径问题。
4. 端口：dsh web 默认 127.0.0.1:3080；当前直接使用，后续做设置页再改为可配置。
5. 与引擎的抽象边界：UI 与引擎之间保持抽象，不把界面代码直接长在 Harness 内部 API 上，为后续换引擎保留可能。

## UI 替换路径（2026-08 补充核实）

背景：官方 dsh web UI 基于 slot（插槽）的客户端插件组合。三栏布局由 `dsh-client-ui-layout` 注册，左侧栏由 `dsh-client-ui-sidebar` 注册进 `sidebar` slot，并进一步暴露 `sidebar.brand.*`、`sidebar.workspaces`、`sidebar.settings` 等子 slot；会话/Workspace 数据通过标准钩子（`useSessions`、`useWorkspaces`）注入，替换方可获得与官方侧边栏相同的接口。

约束：

1. 应用内安装产物只有预构建 dist（`lib/client.js`），无法在其上做源码级修改；任何改动都会在 dsh 升级时丢失。
2. 承接关键决策 2（不 fork）：不在 Harness 源码仓上维护自己的分支。

在此约束下，后续替换 UI 只有两条候选路线，尚未选型：

- **路线 A：完全自研 UI**。Electron 壳直接加载自有前端，通过 dsh 本地服务 API 对接引擎；与官方 Web UI 彻底解耦，不受上游 slot 契约变动影响，但需自行覆盖全部界面能力（会话、设置、工具渲染、审批交互等），工作量大。
- **路线 B：自有插件做模块替换（官方预期方式，2026-08 二次核实修正）**。不 fork 源码仓、不重建官方前端 dist：dsh 原生支持 `dsh plugin --profile web add <package>` 将第三方插件包装进 profile，profile 即「官方 bundle 层 + 用户覆盖层」的有序栈；客户端插件产物是自包含的 `lib/client.js`（`window.__ModuleLoader__.load` 格式，CSS 内联、React 由运行时 require 提供），可用自有 esbuild 构建。替换面板通过 slot 声明/注入实现（如替换 `sidebar` 注册方或注入 `sidebar.workspaces` 子 slot），sidebar 官方文档明确支持部署包替换其注册值。剩余代价：dsh 尚处 rc 阶段（0.1.1-rc.2），slot 契约与 ModuleLoader 格式可能变动，需锁定版本并在升级时做回归；自有插件需维护一条小构建链。

选型（2026-08 用户已定）：走路线 B，用自有插件从外壳性模块（如左侧栏）开始逐个替换，最终替换整个官方 Web UI；路线 A（完全自研 UI）不再是独立选项，而是本路线走完后的自然终态。边界与断点：越靠近对话区等核心交互链，越接近重写，且需自有公共底座（theme token、UI primitives、数据钩子）替代官方运行时；替换的模块越多，dsh 升级时的回归面越大。每替换一个模块前，先核实该模块的耦合点与代价。

分发与集成方式（2026-08 与用户对齐）：插件是构建期产物，不是用户运行时概念。自有 UI 插件与官方插件同等待遇，作为应用依赖打进安装包，随版本一起分发；每个版本打包「本版选择的插件集合」——被自有插件替换掉的官方模块不再打包。用户全程只有一个动作：安装/升级软件，不存在任何运行时"装插件"步骤。（dsh 的 `dsh plugin add` 是终端用户现场装插件的开发者玩法，不适用于本产品。）自有插件如何以内置依赖方式进入 dsh profile 组合，留待首个替换插件落地时由执行方确定。

## 已核实项（V0.0.1 验证结论）

1. **端口与参数支持**：已验证 dsh web 支持 `--port <port>`（传 0 可由系统自动分配）、`--host <host>` 以及 `--no-open`（禁止自动唤起外部默认浏览器）。
2. **依赖与打包机制**：Harness 及其配套插件包通过 npm dependencies 内置；打包配置使用 `asarUnpack: ["node_modules/**"]`，在生产环境以 `ELECTRON_RUN_AS_NODE=1` 及 `--expose-internals` 启动，完整兼容所有原生预编译模块（koffi、node-pty）。
3. **Profile 初始化与系统兼容**：dsh 内置 healProfilesModuleFallback 软链机制；已落地 Windows 下 Directory Junction 的安全解除与更新补丁（scripts/patch-dsh.js），无需用户手动介入。

## 已核实项（2026-08-20 补充：安装耗时与 asar 收窄）

1. **asar 收窄实测不可行**：试验构建将 node_modules 封入 app.asar 后，安装释放文件数可从 11,795 个降至 53 个，但引擎启动失败（ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-client-ui-goal'）。根因：dsh 启动时通过 `$DSH_HOME/profiles/node_modules` 下的 junction 将内置插件解析回应用 node_modules 的真实目录，junction 目标不能是 asar 虚拟路径。`asarUnpack: ["node_modules/**"]` 是 dsh profile 架构的硬约束，不是可优化项。
2. **安装耗时基线**：v0.0.2 安装需释放约 11,795 个文件（约 104 MB），主要构成为 dsh 依赖树：pi-ai 拉入的 4 家 LLM provider SDK（约 2,900 个文件）、shiki 语法高亮（约 800 个）、smithy / hono 等，均为运行时必需，应用层不可剪。治本依赖 dsh 上游对 provider SDK 做惰性化；体验层可选「首启动延迟解压」方案（总时长不变，仅改善感知）。
