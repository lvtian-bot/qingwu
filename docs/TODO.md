# 青梧 待办

产品定位与边界见 product-positioning.md；历史已完成事项见 TODO-ARCHIVE.md。

待办记录的任务不代表一定要做，是可以探讨的。如果实现过程中会带来更大的问题，或成本大于收益，必须提出来。

## 记录规则

1. 所有任务分为三类：新功能、Bug 修复、暂不考虑。
2. 新增任务一律追加到对应分类末尾。
3. 任务完成后标记 [x]，并按 Obsidian Tasks 格式记录完成时间：✅ YYYY-MM-DD。已完成项说明保持简短。
4. 版本发布时，将已完成 [x] 项统一剪切归档至 TODO-ARCHIVE.md 对应版本下。

## 新功能

- [x] 自有代码迁移 TypeScript：主进程 / preload / 渲染层全量 .ts/.tsx，strict 类型检查纳入 npm run check 门禁，为后续自有插件对接 dsh 的 TS 类型契约打基础。 ✅ 2026-08-22（类型检查与构建通过；Windows 运行时行为无改动预期，待随下次实际使用回归）
- [x] 自研界面（阶段 1：跑通主干）：主进程通信桥（fetch 转发 + 事件流转发）、界面骨架（会话列表、发消息、流式回复、审批卡）、「视图」菜单界面切换项；官方界面零改动。技术路线见 tech-architecture.md「UI 路线（2026-08-23 修订）」 ✅ 2026-08-23（npm run check 通过；RPC 信封格式已对真实引擎实测验证；界面交互待用户实际运行验证）
- [ ] 自研界面（阶段 2：功能补全 + 视觉定稿）：工作区管理、工具调用展示、模型选择、会话重命名、codex 风格视觉定稿
- [ ] 自研界面（阶段 3：默认切换 + 打磨）：默认打开自研界面、引擎断连等异常兜底
- [ ] dsh 升级契约闸门：自研 UI 协议类型改为直接依赖 @deepseek-ai/dsh-host-apiproxy 的 ./api 约定层，使接口变更在编译期暴露（当前阶段 1 为手写最小类型）

## Bug 修复

- [x] 发布工作流回写 CHANGELOG 必然非快进失败：CI 在 tag 检出上直接推 master，master 领先 tag 即被拒。改为切到远端 master 顶端重新生成后再推，消除结构性失败，仅剩秒级并发窗口。 ✅ 2026-08-22（.github/workflows/release.yml）

- [x] Windows 下 Agent 执行命令时不断闪现控制台窗口：Electron 主进程无控制台，dsh 子进程（pwsh 等）各自新建控制台窗口所致。方案：主进程启动时 AllocConsole 并立即 SW_HIDE 隐藏，让全部子进程继承该隐藏控制台；属青梧自有实现，不依赖 dsh 上游。 ✅ 2026-08-21（src/main/console.js，koffi 调用 Win32；待用户实际运行验证）
- [x] 标题栏菜单点击外部空白关闭后按钮高亮不消失：Electron 原生菜单 popup 回调在"点击外部关闭"时不触发（electron#17341）。改为以菜单关闭后落点视图的 focus 事件作为确定关闭信号，通知标题栏清除高亮。 ✅ 2026-08-21（src/main/menu.js；待用户实际运行验证）
- [x] 标题栏菜单按 Esc / 再点按钮等关闭后高亮仍不消失（v0.0.8 实测）：popup 回调在这些无焦点变化的关闭路径下同样不触发，focus 兜底只在焦点转移时生效，此类路径全部无信号。改为 popup 处理器收拢至 menu.ts 并以 popupOpen 门控三路关闭信号（callback / webContents focus / 窗口 blur）；渲染层新增指针事件守卫，利用原生菜单开启期间页面收不到指针事件的特性，收到首个 mousemove/mousedown 即清除高亮；顺带移除粘滞状态下会引发幻影菜单的 onMouseEnter 悬停切换。 ✅ 2026-09-07（src/main/menu.ts、src/renderer/src/TitleBar.tsx；沙箱验证信号链路，类型检查与构建通过；真实手势待用户实际体验）
- [x] 升级 dsh 0.1.2-rc.1 后应用无法启动：新版引擎 Web 面强制 token 鉴权，就绪探测对根路径收到 401 即判未就绪，25 秒超时中止启动。改为按行解析引擎启动日志中的带 token Web 地址作为就绪探测与服务地址（解析失败退回裸地址以兼容旧版）；webview 由此携带 token 加载；主进程桥新增 token→cookie 握手并在 RPC POST 上携带。package.json 已恢复完整结构（scripts/devDependencies/build）并保留 0.1.2-rc.1 依赖；dsh-app-boot 的 junction 补丁已在上游重写修复，postinstall 移除。 ✅ 2026-09-08（src/main/harness.ts、src/main/dsh-bridge.ts、package.json；dev 启动实测就绪）
  - 遗留：自研桥对 0.1.2 的契约仍断裂——RPC 方法名全部 404（新 API 为 controller 形态）、events.mux/host 事件流无法连接（WS 携带 cookie+Origin 仍被挂断），官方界面不受影响（webview 自带 cookie 同源直连）。迁移工作归入下方「dsh 升级契约闸门」；期间原生自研界面的数据调用会失败，事件流重连日志每 3 秒报错属预期。
- [x] 自研桥迁移至 dsh 0.1.2 typert/gateway 契约（上一条遗留的落地）：一元调用为 POST /api/<endpoint>（如 session/list），载荷为具名参数包 {args} 信封；事件流统一为 /api/remote.mux 单条 WS（鉴权只认握手 cookie），桥内多路复用（open/cancel + item/error/end），断线自动重连并重放已开流；$events 逻辑流承载 api-session/* 通知与 approval/request、user-questions/request 瀑布，回执走 POST /api/$events/result；渲染层会话内容改用 session/follow 日志流（开场快照 + 实时事件），workspace.list 改由 workspace/follow 基线流承载，host.pickDirectory 改 directoryPicker/pick，session.prompt 增加 requestId。新增直接依赖 ws（remote.mux 握手需自定义 cookie 头）。 ✅ 2026-09-08（src/main/dsh-bridge.ts、src/renderer/src/native/*、src/shared/types.ts；wire 层已对独立引擎实测：session/list、session/create、session/prompt、session/cancel、workspace/follow、session/follow、$events ready 均返回 ok；各 endpoint 具名参数形态以 typert.remote-client.d.ts 为准——session/list 为 _request，其余带参端点为 request；界面交互待用户实际运行验证）

## 暂不考虑

- [ ] 标题栏菜单打开后悬停切换菜单（自绘面板方案）：观感不佳已回退，仅保留未选中灰显；原生菜单模态特性导致该交互必须自绘，后续需完整自研方案再评估
- [ ] macOS / Linux 发行版
- [ ] 安装提速（首启动延迟解压 node_modules）：安装包秒级装完、首次启动应用内解压带进度；总时长不变（杀软逐文件扫描成本仍在），治本依赖 dsh 上游 provider SDK 惰性化，上游变化后重新评估
