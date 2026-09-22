# 青梧 维护导航

本页用于按任务定位代码与验证方法。产品取舍见 [产品定位](product-positioning.md)，当前通信机制与关键决策见 [技术架构](tech-architecture.md)，未完成事项见 [待办](TODO.md)，发版见 [发布流程](release.md)。历史归档只在追查决策或回归来源时读取。

## 按任务阅读

下表路径以仓库根目录为起点，`native/` 指 `src/renderer/src/native/`。先读目标模块与直接调用方；涉及共享状态或接口时再扩展到关联模块。

| 任务                                   | 首先阅读                                                                                                                                           | 关联边界                                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动失败、退出残留、命令闪窗、黑屏诊断 | `src/main/index.ts`、`src/main/app-lifecycle.ts`、`src/main/harness.ts`、`src/main/console.ts`、`src/main/diagnostics.ts`                          | `src/main/config.ts`、`src/main/logging.ts`、`src/main/window.ts`、`scripts/fetch-node-runtime.cjs`、`scripts/before-pack.cjs`                                                                                                     |
| 切换界面、菜单、托盘、窗口焦点         | `src/main/window.ts`、`src/main/menu.ts`、`src/main/tray.ts`                                                                                       | `src/main/settings.ts`、`src/main/window-state.ts`、`src/renderer/src/TitleBar.tsx`                                                                                                                                                |
| 引擎请求、鉴权、审批回执、断线         | `src/main/dsh-bridge.ts`、`src/shared/dsh-wire.ts`                                                                                                 | `src/preload/index.ts`、`src/shared/types.ts`、`native/rpc.ts`、`native/protocol.ts`                                                                                                                                               |
| 会话实时输出、历史、队列               | `native/useEngineStreams.ts`、`native/events.ts`、`native/NativeApp.tsx`（编排）                                                                    | `native/useChatScroll.ts`、`native/TurnItems.tsx`、`native/QueueStrip.tsx`、`native/protocol.ts`                                                                                                                                  |
| 输入框、模型与权限选择                 | `native/Composer.tsx`、`native/ComposerControls.tsx`、`native/WorkspaceChip.tsx`                                                                   | `native/ChatComposer.tsx`、`native/useModelSelection.ts`、`native/useComposerDrafts.ts`、`native/NativeApp.tsx` 中发送处理、`native/protocol.ts`                                                                                    |
| 审批、问答、计划确认                   | `native/PendingInteraction.tsx`                                                                                                                    | `native/PendingInteraction.tsx` 中 `groupPendingEntries`（事件归属）、`native/NativeApp.tsx` 中回执处理、`src/main/dsh-bridge.ts`                                                                                                  |
| 项目、会话侧栏与置顶                   | `native/SessionSidebar.tsx`、`native/SidebarRows.tsx`、`native/sidebar-data.ts`                                                                    | `native/useEngineStreams.ts`（工作区订阅）、`native/useSessionActions.ts`（会话/工作区操作）                                                                                                                                        |
| 设置页、模型供应商与应用配置           | `native/SettingsPage.tsx`（导航壳）、`native/ModelsTab.tsx`、`native/ProviderDetail.tsx`、`native/useProviderDirectory.ts`、`src/main/settings.ts` | `native/settings-domain.ts`（纯域函数）、`native/settings-ui.tsx`、`native/GeneralTab.tsx`、`native/ArchivedSessionsTab.tsx`、`native/PermissionsTab.tsx`、`native/useDshSettings.ts`、`native/protocol.ts`、`src/shared/types.ts` |
| 图片、Markdown、工具详情               | `native/images.tsx`、`native/markdown.tsx`、`native/ToolCard.tsx`                                                                                  | `native/useComposerDrafts.ts`（附件草稿与粘贴）、`native/RightPanel.tsx`、`native/panel-data.ts`                                                                                                                                    |
| 上下文占用、布局和样式                 | `native/ContextMeter.tsx`、`native/usePanelWidth.ts`、`native/native.css`                                                                          | 对应界面组件、`src/renderer/src/titlebar.css`                                                                                                                                                                                      |
| 更新与发布                             | `src/main/update.ts`、`src/main/update-window.ts`、`src/renderer/src/UpdateWindow.tsx`                                                             | `package.json`、`.github/workflows/`、`scripts/before-pack.cjs`、`docs/release.md`                                                                                                                                                 |

`native/NativeApp.tsx` 负责页面编排、发送管线与决策回执；跨组件状态按职责分层在各 hooks：引擎流订阅与事件投影在 `useEngineStreams.ts`，滚动管理在 `useChatScroll.ts`，草稿与附件在 `useComposerDrafts.ts`，会话/工作区操作在 `useSessionActions.ts`，模型与权限选择在 `useModelSelection.ts`，引擎连接状态在 `useEngineConnection.ts`。独立展示、侧栏交互和事件折算应放在对应模块。界面重构先保持行为，再单独修复有明确证据的缺陷，避免同时改变布局、消息语义和通信方式。

## 关键链路与数据归属

- 启动：主进程设置应用数据路径、取得单实例锁与隐藏控制台，启动随包 Node 中的 dsh，等待服务就绪后创建窗口并启动通信桥。
- 发送：输入框 → `NativeApp` → `rpc.ts` → preload → `DshBridge` → dsh。宿主通过事件流返回历史、实时输出、运行状态与待处理项，界面据此更新；提交成功不等于任务执行完成。
- 重连：通信桥重连 WebSocket 并重开已注册逻辑流；会话界面处理开场快照与实时 revision。WebSocket 重连不等于引擎进程自动重启，当前没有自动重启产品机制。
- 应用设置：`%APPDATA%/qingwu/settings.json` 保存关闭行为与界面模式，`window-state.json` 保存窗口位置尺寸；路径由 `src/main/paths.ts` 统一设置。
- 界面偏好：置顶和面板宽度保存在 renderer 的 localStorage。输入草稿等页面内状态不是引擎持久化数据，不能承诺重启后保留。
- 草稿提交：清理时核对提交前的草稿版本；失败只恢复未被再次编辑的归属会话，切到其他会话时不改当前输入。首次发送清理空白页草稿，失败恢复到已创建会话。
- 历史加载：切换会话、重开订阅和新快照使在途翻页失效；有效响应即将前插时才记录滚动锚点。会话流打开失败或异常结束必须解除加载状态并提示错误。
- 引擎数据：会话、项目、模型配置、权限等由 dsh 管理，经 API 访问；应用不另建一套副本。dsh 数据根默认是用户目录下的 `.dsh`，可受 `DSH_HOME` 或引擎配置覆盖；青梧继承进程环境，因此可能与命令行 dsh 共用数据。排障前核对实际配置，不删除或重建用户数据目录。

## 开发与检查

当前支持 Windows x64，开发环境使用 Node 24 与 npm；Electron 和随包 Node 的确切版本分别由 `package.json`、`scripts/fetch-node-runtime.cjs` 管理。版本变更先按 `AGENTS.md` 确认。

```sh
npm ci
npm run runtime:node
npm run dev
```

`npm run runtime:node` 从 Node 官方下载并校验运行时；没有准备时开发启动可能使用本机 Node 或退回 Electron，表现不一定等于安装版。`npm start` 仅预览已有构建，先运行 `npm run build`。

```sh
npm run typecheck
npm test
npm run check
```

`check` 包含类型检查、测试与构建，CI 使用同一入口。测试直接加载源码，不启动真实 Agent 或改动用户引擎数据；测试中只使用虚构凭据。

- 桌面测试覆盖退出协调、引擎清理、启动日志脱敏与界面目标等可隔离行为。
- 界面测试覆盖消息事件、队列和在飞流记录等纯逻辑；`tests/native-session-lifecycle.test.cjs` 使用 React 调度与宿主替身验证实际 hooks 的草稿恢复、会话切换、翻页失效与流失败处理。这些测试不能验证实际布局与键盘焦点。
- 契约测试从已安装 dsh 的依赖链解析公开 controller 约定，验证界面消费的数据和调用参数；桥接信封与流帧另做运行时结构检查。新增端点或帧类型时须同时扩展对应测试，不能把未覆盖的 API 当成已经验证。

测试文件在 `tests/`，`tests/helpers/load-ts.cjs` 仅负责测试环境中的 TypeScript 加载与依赖替身，正常类型检查仍由 tsc 承担。项目没有额外安装测试框架。

## 轻量交互验证

只验证本次改动涉及的场景；无法可靠控制界面时明确记录未验证项，不把构建通过当成体验通过。

| 改动范围   | 最小验证场景                                                           |
| ---------- | ---------------------------------------------------------------------- |
| 启停与窗口 | 启动成功；启动期间退出；托盘隐藏与恢复；真正退出后本次引擎与子进程结束 |
| 双界面操作 | 两种界面各自尝试重新加载、缩放和恢复焦点，操作应作用于当前界面         |
| 会话与输入 | 新建会话、发送、流式显示、停止；运行中排队；切换会话后草稿与状态正确   |
| 审批与问答 | 允许、拒绝、填写回答；提交失败保留待处理项并显示错误，不假装成功       |
| 历史与重连 | 加载更早历史；切回运行中的会话；连接恢复后快照与增量不丢失、不重复     |
| 依赖或打包 | 两套界面分别会话冒烟；实际命令执行；安装版运行时与更新产物检查         |

## 常见排查入口

- 无法就绪：先核对引擎入口、随包 Node、3080 端口是否被其他服务占用、子进程是否提前退出。当前端口固定，不自动接管或终止其他 dsh。
- 官方界面正常而青梧界面异常：先查 cookie 握手、RPC 信封与具名参数、逻辑流及帧版本；勿先重装引擎或清空数据。
- 命令闪窗：核对是否使用随包 `node.exe` 以及主进程是否取得隐藏控制台；不得通过杀死引擎对应 conhost 解决，原因见架构文档。
- 引擎停止失败：保留失败信息并重试退出，排查权限与进程状态；不要对所有 Node、PowerShell 或 conhost 进程做批量结束。
- 退出保证的边界：Windows 正常退出等待 `taskkill /T /F` 清理本次引擎进程树；若根进程已自行消失，只能验证根进程不存在，现有模型不能据此证明已脱离的孙进程也全部结束。应用被强杀或系统注销也不属于正常退出事件的保证范围。
- 排障日志：仅保留脱敏后的地址与错误；不得输出或粘贴 token、cookie、API 密钥与完整环境变量。

## 文档更新边界

模块拆分或职责变化更新本页导航；通信、生命周期或数据归属变化更新架构；开发命令变化更新 README 与本页；发布步骤变化更新发布流程。TODO 保持当前任务，已完成事项在发版时归档。无需为每个函数维护说明书，也不把日常修改流水账重复写进架构文档。
