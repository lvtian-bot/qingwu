# 青梧技术总览

本文记录当前架构和跨模块约定。具体职责、主要代码入口及容易再次踩到的技术约束放在对应模块说明中；dsh 版本以 `package.json` 与锁文件为准。

## 技术边界

青梧是 Electron 桌面客户端。自有代码使用 TypeScript、React；Windows 安装包由 electron-builder / NSIS 构建。`@deepseek-ai/dsh` 作为随包 npm 依赖运行在独立 Node 子进程中，负责 Agent、会话、工具、模型、沙箱与 Skill。青梧不 fork 引擎、不另实现 Agent Loop，也不另存一份引擎业务数据。

```text
青梧界面（React） → preload / IPC → 主进程 DshBridge ─┐
DeepSeek 界面（WebContentsView） → 本地 HTTP / WS ──┤
                                                 ↓
                            同一个 dsh 服务（独立 Node 子进程）
```

主进程管理应用启停、窗口、托盘、更新及 dsh 子进程；preload 只暴露受限 IPC。青梧界面消费主进程转发的 RPC 与事件流，DeepSeek 界面加载引擎原有 Web UI。两套界面共享同一引擎与会话数据，可切换。`src/shared/types.ts` 定义 IPC 类型，`src/shared/dsh-wire.ts` 解析桥接信封；青梧界面消费的引擎协议集中在 `src/renderer/src/native/protocol.ts`。

## 模块

| 模块                                              | 职责与说明                                         |
| ------------------------------------------------- | -------------------------------------------------- |
| [桌面应用](modules/desktop-app.md)                | 启停、窗口与双界面、菜单和托盘、更新、桌面诊断。   |
| [dsh 运行与连接](modules/dsh-integration.md)      | 引擎运行时、启动与清理、鉴权、RPC 与逻辑流代理。   |
| [会话与项目](modules/sessions-workspaces.md)      | 项目与会话操作、流式展示、历史、草稿、审批与队列。 |
| [设置与模型](modules/settings-models.md)          | 应用设置与引擎设置的分界、模型供应商、权限选择。   |
| [工作区文件与交付](modules/files-deliverables.md) | 文件变更和交付物投影、右侧面板、桌面文件操作。     |
| [界面与视觉设计](modules/ui-design-system.md)     | 视觉设计语言、色彩 Token、组件交互动线、暗色模式。 |

模块按功能和数据责任划分，源代码可能跨主进程、preload 与渲染层。修改跨模块接口时，先核对两端实现与共享类型，再更新相关说明。

## 跨模块约定

- **引擎数据归属**：项目、会话、模型供应商和权限以 dsh 为准，经其 API 操作；应用设置另存于青梧的 `userData`。界面里的草稿、折叠与宽度等展示状态不能当成引擎持久化数据。
- **通信路径**：青梧界面不直连 dsh 的 `/api`，由主进程桥代理；一元请求使用 `POST /api/<endpoint>` 的 `client-request` 信封和 `{ args: ... }` 载荷；逻辑流共用 `/api/remote.mux`。鉴权信息只留在主进程，日志和错误不得泄露 token、cookie 或密钥。具体回执和重连约束见 [dsh 运行与连接](modules/dsh-integration.md)。
- **实时状态**：`$events` 承载全局通知及审批/问答，`workspace/follow` 承载项目状态，`session/follow` 承载选中会话快照与增量。WebSocket 重连会重开已注册逻辑流，但不会自动重启 dsh 进程；会话投影仍须用新快照重建，不能只拼接旧增量。
- **引擎版本**：dsh API 有兼容性破坏风险。升级依赖时核对已安装版本的 controller 约定和契约测试，再验证双界面会话、审批、流式输出与命令执行；独立青梧界面不等于可以直接替换引擎地址。
- **随包运行时**：Windows 安装版使用随包的控制台子系统 `node.exe` 启动 dsh；版本应与 Electron 内置 Node 对齐。引擎和插件需真实 `node_modules` 路径，故打包保留 `asarUnpack: ["node_modules/**"]`。原因与降级边界见 [dsh 运行与连接](modules/dsh-integration.md)。
