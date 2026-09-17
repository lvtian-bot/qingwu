# 青梧 技术路线与架构决策

记录青梧已确定的技术路线、架构分层与关键决策。当前接口以随包锁定的 dsh 0.1.5-rc.2 为核对基线，具体版本以 `package.json` 和锁文件为准。按任务阅读的源码入口、开发与验证方法见 [维护导航](maintenance.md)；历史实现不作为当前操作步骤。

## 技术栈（已定）

- Electron：桌面壳。DeepSeek Harness 本身是 Node.js / TypeScript 技术栈，Electron 自带 Node 与 Chromium，天然吻合；不选 Tauri，避免凭空增加 Rust 与 Node sidecar 管理复杂度。
- TypeScript：自有代码（主进程 / preload / 渲染层）统一使用 TypeScript，strict 模式，类型检查纳入 npm run check 门禁；dsh 生态本身是 TS，后续自有 UI 插件可直接复用其类型契约。
- @deepseek-ai/dsh：DeepSeek Harness CLI / 运行时，作为 npm 依赖随应用打包并锁定版本，用户无需单独安装。
- 打包：electron-builder / NSIS，产出 Windows 安装包。

## 分层（当前）

```
青梧界面（React）→ preload / IPC → 主进程 DshBridge ─┐
DeepSeek 界面（WebContentsView）→ 本地 HTTP / WS ────┤
                                                    ↓
                     同一 dsh 服务（独立 Node 子进程）
                     Agent / Session / Tools / LLM / Sandbox / Skills
```

主进程负责引擎生命周期、桌面窗口与更新，通信桥负责鉴权、请求封装和逻辑流转发。渲染层负责界面与消息展示投影，不实现 Agent Loop 或直接修改引擎存储。`src/shared/types.ts` 是 preload 与两端共用的 IPC 类型约定；界面消费的引擎数据类型集中在 `native/protocol.ts`。

## 关键决策

1. 引擎随包内置并锁定版本：App 锁定某个 dsh 版本，测试确认后再发布；不依赖用户环境的全局安装，避免版本不一致问题。dsh 当前快速迭代，升级需单独验证。
2. 不合并源码：Harness 作为依赖使用，不 fork 进本仓库，保持引擎与产品代码独立。
3. 运行方式（2026-09-11 修订）：用**控制台子系统（console subsystem）的官方 Node 运行时装包内启动** dsh 的 CLI 入口（`lib/bin.js`），避免依赖 .bin 脚本在打包后的路径问题。原方案是用 `ELECTRON_RUN_AS_NODE=1` 跑 Electron 自带运行时，但它会让 Agent 每执行一条命令闪一个黑窗：electron.exe 是 GUI 子系统程序，而 **GUI 进程不继承父进程的控制台**，dsh 又用 `process.execPath` 逐层派生 Windows Job runner 与 windows-acl runner，整条链因此都没有控制台，最后那条 pwsh（控制台子系统）只能自己新建一个可见控制台窗口；引擎升级到 0.1.5-rc.1 后该缺陷暴露（0.1.5-rc.2 仍未改变派生方式），主进程 `acquireHiddenConsole()` 的隐藏控制台也只能覆盖主进程自己的控制台子进程。改用 node.exe 后，引擎、runner 与 pwsh 全部继承主进程那个隐藏控制台。要点：运行时版本与 Electron 内置 Node 对齐（当前 24.18.1，升级 Electron 时用 `scripts/fetch-node-runtime.cjs` 顶部常量同步）；由该脚本按官方 SHASUMS256.txt 校验后解到 `build/node-runtime/`（不入库），打包经 `extraResources` 落到 `resources/node/node.exe`，打包前钩子 `scripts/before-pack.cjs` 保证就绪且失败即打包失败（避免静默产出会闪窗的包）；找不到 Node 运行时时退回 Electron 方式；已有 Node 但主进程拿不到控制台时仍用 Node 并启用 windowsHide，这两种降级都可能重新出现命令闪窗。代价：安装包体积增加约 35 MB（node.exe 解包 88 MB）。运维注意：引擎的控制台是命令执行的依赖（受限子进程必须共享宿主控制台），**不要终止引擎控制台对应的 conhost**——宿主控制台被杀后，命令会以 `STATUS_DLL_INIT_FAILED (0xC0000142)` 失败，需重启应用才能恢复。
4. 端口：dsh web 默认 127.0.0.1:3080；当前直接使用，后续做设置页再改为可配置。
5. 与引擎的抽象边界：通信传输集中在主进程桥，界面调用入口与协议类型集中管理，不寄生于官方前端运行时。当前消息事件、审批与队列语义仍与 dsh 耦合；未来换引擎需要重做适配和相关状态处理，不能视为直接替换一个地址。

## UI 路线（2026-08-23 修订：独立前端 + 双界面并存）

> 命名说明：文档中的「自研界面」即用户可见的「青梧界面」（菜单文案），与「DeepSeek 界面」（官方 dsh web UI）相对。

背景：2026-08 曾选型「自有插件渐进替换官方 Web UI」（路线 B），并认定完全自研 UI（路线 A）是该路线走完后的自然终态。2026-08-23 针对自研 UI 的对接方式完成一轮本地解剖与生态调研，**修订为：独立前端直调 dsh 本地 API，官方 Web UI 长期原样并存，应用内可切换**。

当前通信约定（0.1.2 起迁移，按 0.1.5-rc.2 安装产物核对）：

1. 一元请求走 `POST /api/<endpoint>`，例如 `session/list`。请求为 `client-request` 信封，含 `rpcId`、`method` 与 `payload: { args: ... }`；返回 `server-response`，业务结果以 `ok/value` 或 `ok/error` 区分。各端点的具名参数以当前 controller 的公开约定为准。
2. 全部逻辑流复用 `/api/remote.mux` 一条 WebSocket。桥发送 `open/cancel`，接收 `item/error/end`；`$events` 承载通知与审批问答，`workspace/follow` 承载项目状态，`session/follow` 承载会话快照与增量。审批问答回执走 `POST /api/$events/result`，同样必须包 `{ args: ... }`。
3. 本地 Web 服务需要鉴权。启动时解析引擎提供的鉴权地址，桥用它换取 cookie；WebSocket 握手携带 cookie。青梧界面经 IPC 访问主进程，官方界面在本地同源页面中访问服务。日志与报错不得输出 token、cookie 或其他凭据。
4. 0.1.5 起，实时文本与思考通过 `session/follow` 的 `assistant-stream` 帧传递，订阅需声明 `assistantStream: true`。历史快照携带在飞基线；界面检查 revision 连续性，跳号时重新订阅并从快照重建，不能只依赖旧 `assistant/chunk` 事件。

2026-08-23 选型时使用的 `dsh-host-apiproxy`、`events.mux/events.host` 和免认证机制属于旧版历史，已被 controller/gateway 与上述通信方式替代。迁移记录见 `TODO-ARCHIVE.md` 的 2026-09-08 条目。独立前端路线继续保留，但旧包名与端点不能继续作为升级实施依据。

插件路线为何错配：其本质是寄生于官方前端运行时的模块替换（React 由官方运行时提供、CSS 内联、视觉对齐官方 theme token），适合改良官方 UI，不适合布局风格完全不同的自研界面；且其终点仍是完全自研，渐进中间产物到终点时大部分需重写。

风险与升级闸门：

- 官方 README 明示 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"，dsh-tui 曾经历事件流 SSE→WebSocket 的破坏性变更。该 API 非官方承诺契约，跟进责任在我方。
- 闸门一：契约验证。界面类型保留自身消费子集，测试从已安装 dsh 的依赖链解析 controller 的公开类型出口，编译端点参数、返回值与订阅帧的兼容性断言。运行时边界检查与行为测试补充类型无法证明的异常路径；这不等于所有 RPC 调用已获得端到端类型安全。具体覆盖范围见维护导航与测试文件。
- 闸门二：升级流程。先确认依赖版本变更 → 升依赖并核对锁文件 → `npm run check` → 双界面冒烟（同一引擎，两套界面分别跑会话、审批、流式输出）与命令执行 → 按发布流程确认版本并发版。
- 官方 UI 是现成对照组与参照系：升级后对比观察官方 UI 的演进方向。

实现形态：

- 自研 UI 为 Electron renderer 内的独立界面层（与自研标题栏同页，位于标题栏下方区域），通过主进程桥（IPC fetch 转发 + WebSocket 事件流转发）对接引擎；官方 Web UI 保持在现有 `WebContentsView` 中，零改动。
- 界面模式（`uiMode`：official / native）持久化于应用设置，切换即时生效（隐藏/显示对应视图层），两套界面共享同一引擎实例与会话数据。

引擎备选：Pi（badlogic/pi-mono）曾评估，当前未引入。青梧的启动、打包、通信与消息处理围绕 dsh；独立界面有利于保留布局与展示组件，但换引擎仍有适配成本。重新评估触发条件：dsh 停止维护，或其 API 变动频繁到升级闸门持续大面积报警。

## 已核实项（V0.0.1 验证结论）

1. **端口与参数支持**：已验证 dsh web 支持 `--port <port>`（传 0 可由系统自动分配）、`--host <host>` 以及 `--no-open`（禁止自动唤起外部默认浏览器）。
2. **依赖与打包机制**：Harness 及其配套插件包通过 npm dependencies 内置；打包配置使用 `asarUnpack: ["node_modules/**"]`，启动参数为 `--expose-internals`，完整兼容所有原生预编译模块（koffi、node-pty）。执行该入口的运行时自 2026-09-11 起改为随包的控制台子系统 Node（见「关键决策 3」），此前为 `ELECTRON_RUN_AS_NODE=1` + Electron 内置运行时。
3. **Profile 初始化与系统兼容（历史措施）**：早期曾用 `scripts/patch-dsh.js` 修补 Windows Directory Junction 行为。2026-09-08 升级时上游已重写修复，项目移除了补丁与 postinstall；当前无需恢复或执行该脚本。

## 已核实项（2026-08-20 补充：安装耗时与 asar 收窄）

1. **asar 收窄实测不可行**：试验构建将 node_modules 封入 app.asar 后，安装释放文件数可从 11,795 个降至 53 个，但引擎启动失败（ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-client-ui-goal'）。根因：dsh 启动时通过 `$DSH_HOME/profiles/node_modules` 下的 junction 将内置插件解析回应用 node_modules 的真实目录，junction 目标不能是 asar 虚拟路径。`asarUnpack: ["node_modules/**"]` 是 dsh profile 架构的硬约束，不是可优化项。
2. **安装耗时基线**：v0.0.2 安装需释放约 11,795 个文件（约 104 MB），主要构成为 dsh 依赖树：pi-ai 拉入的 4 家 LLM provider SDK（约 2,900 个文件）、shiki 语法高亮（约 800 个）、smithy / hono 等，均为运行时必需，应用层不可剪。治本依赖 dsh 上游对 provider SDK 做惰性化；体验层可选「首启动延迟解压」方案（总时长不变，仅改善感知）。
