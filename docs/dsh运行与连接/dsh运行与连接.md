# dsh 运行与连接

## 职责

- `HarnessManager` 从当前应用包解析 dsh CLI，启动本地服务、探测就绪，并在正常退出时清理本次引擎进程树。默认监听 `127.0.0.1:3080`；应用不接管或终止其他占用该端口的服务。
- `DshBridge` 代表界面访问 dsh：封装 HTTP RPC、建立一条 WebSocket 并复用多个逻辑流，断线后重连和重开登记的流。preload 暴露受限 IPC，渲染层只经该入口访问引擎。
- dsh 自行保存项目、会话、权限等业务数据。数据根通常在用户目录下的 `.dsh`，但可被 `DSH_HOME` 或引擎配置改变；排障前应核对实际位置，不清空用户数据。

## 主要代码入口

- 引擎进程：`src/main/harness.ts`、`console.ts`、`config.ts`、`app-lifecycle.ts`、`scripts/fetch-node-runtime.cjs`、`before-pack.cjs`。
- 通信与契约：`src/main/dsh-bridge.ts`、`src/shared/dsh-wire.ts`、`types.ts`、`src/preload/index.ts`、`src/renderer/src/native/rpc.ts`、`protocol.ts`。
- 调用和流的消费方：`src/renderer/src/native/useEngineStreams.ts`、`PendingInteraction.tsx`、`NativeApp.tsx`。

## 不可忽略的技术约束

- **RPC 信封**：一元调用是 `POST /api/<endpoint>`，`client-request` 包含 `rpcId`、`method` 和 `payload: { args: ... }`。`$events` 的审批、问答回执也必须向 `/api/$events/result` 发送 `{ args: { clientId, eventId, outcome } }`。这层 `args` 曾遗漏，造成宿主仍等待回答而界面误以为提交成功；失败时必须显示错误并保留待处理项。
- **鉴权和流**：桥从引擎给出的鉴权地址换取 cookie，WebSocket 握手携带 cookie；查询参数 token 不能代替流握手 cookie。`/api/remote.mux` 使用 `open/cancel` 与 `item/error/end` 管理逻辑流。日志及异常不得输出 token、cookie 或密钥。
- **进程与控制台**：Windows 安装版用随包控制台子系统 `node.exe` 跑 dsh CLI，使引擎及逐层派生的命令进程继承主进程隐藏控制台。若改用 GUI 子系统的 `electron.exe` 作为 Node 运行时，或主进程未取得控制台，Agent 执行命令可能反复闪出黑窗。随包 Node 由脚本校验后准备，版本应与 Electron 内置 Node 对齐；缺失时开发运行可退回其他 Node/Electron，表现不能代表安装版。
- **专属 Profile 隔离与依赖实路径**：青梧启动引擎时采用专属的 `qingwu` Profile（位于 `~/.dsh/profiles/qingwu`），与官方终端 Web 版（`profiles/web`）及官方桌面版（`profiles/desktop`）配置和插件完全物理隔离，首次启动自动初始化；界面里修改的模型供应商、默认模型、权限预设等设置落在该 profile 的 `cordis.patch.yml`，青梧应用设置（`app-settings.json`）也存于该 profile 目录、由主进程直写；凭证（`.credentials.yaml`）、会话、附件与 storages 位于 `~/.dsh` 根级、跨 profile 共享；dsh profile 中的插件 junction 需要真实的 `node_modules` 路径，不能把整棵依赖重新塞进 `app.asar`；当前 `asarUnpack: ["node_modules/**"]` 是运行约束。打包前钩子必须保证随包 Node 就绪。
- **退出边界**：Windows 正常退出用 `taskkill /T /F` 清理本次进程树；若根进程已先消失，只能确认根 PID 不存在，不能由此证明脱离进程树的后代全部结束。不要批量结束系统中其他 Node、PowerShell 或 conhost；终止引擎依赖的 conhost 会使后续命令失败。
- **Windows 工作区权限**：当前 `@deepseek-ai/dsh-sandbox-windows-acl` 在 `workspace-write` 写入授权时，为真实工作区添加路径派生的能力 SID、目录删除拒绝项和可继承的 Low 完整性标签；工作区授权会跨会话保留。若青梧源码目录同时是 dsh 工作区和开发运行目录，Low 标签可能令 Electron 在主进程 JS 执行前以 `0x80000003` 退出，或令随包开发运行时 `build/node-runtime/node.exe` 无法写入用户目录下的 `.dsh` 配置而报 `EPERM`。恢复时分别核对项目根、Electron 和随包 Node 的完整性标签；根目录为 Medium 不代表子文件都已恢复。不要把权限标签复发误判为代码回归，也不要通过授予个人账户完全控制来处理 dsh 的命令审批。
- **升级影响**：dsh API 未承诺稳定，改依赖时核对 controller 的端点参数、返回值、流帧及现有契约测试；还需运行会话、审批、流式输出和命令执行。青梧虽有桥接边界，消息和队列语义仍与 dsh 耦合。
