# 青梧 技术路线与架构决策

记录青梧已确定的技术路线、架构分层与关键决策。改动前先读本文。

## 技术栈（已定）

- Electron：桌面壳。DeepSeek Harness 本身是 Node.js / TypeScript 技术栈，Electron 自带 Node 与 Chromium，天然吻合；不选 Tauri，避免凭空增加 Rust 与 Node sidecar 管理复杂度。
- TypeScript：自有代码（主进程 / preload / 渲染层）统一使用 TypeScript，strict 模式，类型检查纳入 npm run check 门禁；dsh 生态本身是 TS，后续自有 UI 插件可直接复用其类型契约。
- @deepseek-ai/dsh：DeepSeek Harness CLI / 运行时，作为 npm 依赖随应用打包并锁定版本，用户无需单独安装。
- 打包：electron-builder / NSIS，产出 Windows 安装包。

## 分层（当前）

```
自研 UI（独立前端，经主进程桥调用 /api RPC 与事件流）
官方 dsh web UI（原样保留，可切换）
        ↓ 同一本地服务
Harness 引擎（Agent / Session / Tools / LLM / Sandbox / Skills）
```

## 关键决策

1. 引擎随包内置并锁定版本：App 锁定某个 dsh 版本，测试确认后再发布；不依赖用户环境的全局安装，避免版本不一致问题。dsh 当前快速迭代，升级需单独验证。
2. 不合并源码：Harness 作为依赖使用，不 fork 进本仓库，保持引擎与产品代码独立。
3. 运行方式：以 ELECTRON_RUN_AS_NODE=1 运行 dsh 的 CLI 入口（lib/bin.js），避免依赖 .bin 脚本在打包后的路径问题。
4. 端口：dsh web 默认 127.0.0.1:3080；当前直接使用，后续做设置页再改为可配置。
5. 与引擎的抽象边界：UI 与引擎之间保持抽象，不把界面代码直接长在 Harness 内部 API 上，为后续换引擎保留可能。

## UI 路线（2026-08-23 修订：独立前端 + 双界面并存）

> 命名说明：文档中的「自研界面」即用户可见的「青梧界面」（菜单文案），与「DeepSeek 界面」（官方 dsh web UI）相对。

背景：2026-08 曾选型「自有插件渐进替换官方 Web UI」（路线 B），并认定完全自研 UI（路线 A）是该路线走完后的自然终态。2026-08-23 针对自研 UI 的对接方式完成一轮本地解剖与生态调研，**修订为：独立前端直调 dsh 本地 API，官方 Web UI 长期原样并存，应用内可切换**。

修订依据（均已在 0.1.1-rc.2 本地安装产物中核实）：

1. 官方 Web UI 与引擎之间是一套完整的 RPC 协议（`@deepseek-ai/dsh-host-apiproxy`）：`POST /api/<method>` 承载单次调用（46 个方法，覆盖会话全生命周期、workspace、设置、凭据、模型、子代理、目录操作等），`/api/events.mux` 与 `/api/events.host` 两条只下行 WebSocket 推送事件流，审批/问答经下行帧 + `POST /api/respond` 回应。
2. 协议约定层作为 npm 公开导出：`dsh-host-apiproxy` 的 `./api`（领域类型 + Zod schema）与 `./client`（`AbstractApiClient`）浏览器可导入。
3. 信任栅栏明确容许非浏览器客户端：回环地址（127.0.0.1）免认证通过；但带浏览器 Origin 的直连要求 Origin 与 Host 权威一致，因此 renderer 不能直连引擎，须由主进程桥接——官方 web-server 文档描述的 Electron 模式正是「经 IPC 桥接发送 fetch」。
4. 生态先例：dsh-vscode（VS Code 扩展，codex 风格自研 webview）与 dsh-tui（终端客户端）均已直调该 API 走通；官方 SDK（stdio JSON-RPC）与 ACP 能力面过窄（无审批 UI 语义），headless 无交互面，均不适合交互式 UI。

插件路线为何错配：其本质是寄生于官方前端运行时的模块替换（React 由官方运行时提供、CSS 内联、视觉对齐官方 theme token），适合改良官方 UI，不适合布局风格完全不同的自研界面；且其终点仍是完全自研，渐进中间产物到终点时大部分需重写。

风险与升级闸门：

- 官方 README 明示 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"，dsh-tui 曾经历事件流 SSE→WebSocket 的破坏性变更。该 API 非官方承诺契约，跟进责任在我方。
- 闸门一：类型对齐。自研 UI 的协议类型对齐官方约定层（`./api` 类型），契约变化在编译期暴露。（阶段 1 先以手写最小类型落地，契约编译闸门随后续阶段补齐，见 TODO。）
- 闸门二：升级流程。升级 dsh 版本 = 升依赖 → `npm run check` 编译通过 → 双界面冒烟（同一引擎，官方 UI 与自研 UI 各跑一轮会话）→ 发版。
- 官方 UI 是现成对照组与参照系：升级后对比观察官方 UI 的演进方向。

实现形态：

- 自研 UI 为 Electron renderer 内的独立界面层（与自研标题栏同页，位于标题栏下方区域），通过主进程桥（IPC fetch 转发 + WebSocket 事件流转发）对接引擎；官方 Web UI 保持在现有 `WebContentsView` 中，零改动。
- 界面模式（`uiMode`：official / native）持久化于应用设置，切换即时生效（隐藏/显示对应视图层），两套界面共享同一引擎实例与会话数据。

引擎备选：Pi（badlogic/pi-mono）经评估暂不引入。其官方支持自建 UI（pi-web-ui）但引擎哲学为极简（四核心工具），且同为 0.x 无兼容承诺；青梧已建成的打包/启动/修复链均围绕 dsh。自研 UI 只依赖 API 层、不寄生官方前端运行时，这一架构同时保证未来若需更换引擎时界面资产可迁移。重新评估触发条件：dsh 停止维护，或其 API 变动频繁到升级闸门持续大面积报警。

## 已核实项（V0.0.1 验证结论）

1. **端口与参数支持**：已验证 dsh web 支持 `--port <port>`（传 0 可由系统自动分配）、`--host <host>` 以及 `--no-open`（禁止自动唤起外部默认浏览器）。
2. **依赖与打包机制**：Harness 及其配套插件包通过 npm dependencies 内置；打包配置使用 `asarUnpack: ["node_modules/**"]`，在生产环境以 `ELECTRON_RUN_AS_NODE=1` 及 `--expose-internals` 启动，完整兼容所有原生预编译模块（koffi、node-pty）。
3. **Profile 初始化与系统兼容**：dsh 内置 healProfilesModuleFallback 软链机制；已落地 Windows 下 Directory Junction 的安全解除与更新补丁（scripts/patch-dsh.js），无需用户手动介入。

## 已核实项（2026-08-20 补充：安装耗时与 asar 收窄）

1. **asar 收窄实测不可行**：试验构建将 node_modules 封入 app.asar 后，安装释放文件数可从 11,795 个降至 53 个，但引擎启动失败（ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-client-ui-goal'）。根因：dsh 启动时通过 `$DSH_HOME/profiles/node_modules` 下的 junction 将内置插件解析回应用 node_modules 的真实目录，junction 目标不能是 asar 虚拟路径。`asarUnpack: ["node_modules/**"]` 是 dsh profile 架构的硬约束，不是可优化项。
2. **安装耗时基线**：v0.0.2 安装需释放约 11,795 个文件（约 104 MB），主要构成为 dsh 依赖树：pi-ai 拉入的 4 家 LLM provider SDK（约 2,900 个文件）、shiki 语法高亮（约 800 个）、smithy / hono 等，均为运行时必需，应用层不可剪。治本依赖 dsh 上游对 provider SDK 做惰性化；体验层可选「首启动延迟解压」方案（总时长不变，仅改善感知）。
