# 青梧 已完成事项归档

按版本归档已完成任务，保持 TODO.md 精炼聚焦。

## v0.2.0 (2026-09-11)

- [x] 窗口位置记忆：关闭时记录位置、尺寸与最大化状态，下次启动还原；最大化记录还原边界，取消最大化可回到原位置；还原时校验显示器可见性，不可见回退默认尺寸居中。 ✅ 2026-09-11（src/main/window.ts、src/main/window-state.ts；npm run check 通过；窗口生命周期行为待用户实际体验）
- [x] userData 目录规范化：Electron 默认以 productName「青梧」作 userData 目录名，非 ASCII 路径在未来把路径传给引擎或第三方工具时有乱码隐患。新增 paths.ts 于其他模块求值前重定向到 %APPDATA%\qingwu，首次启动自动迁移旧目录中的自有配置（settings.json、window-state.json），Chromium 缓存留在旧目录重建；settings/window-state 路径改惰性求值，不依赖模块加载顺序；构建产物已核实重定向先于一切模块初始化执行。 ✅ 2026-09-11（src/main/paths.ts、src/main/index.ts、src/main/settings.ts、src/main/window-state.ts；npm run check 通过；迁移随本版本首次启动生效，待用户实际确认）
- [x] 关于页引擎版本号过期：手写 harnessVersion 字段随依赖升级漂移（显示 0.1.1-rc.2，实际 0.1.5-rc.1）。改为运行时读取 dsh 包 package.json 真实版本（覆盖 dev 与 asar/asar.unpacked 形态），读取失败显示「未知」，删除手写字段。 ✅ 2026-09-11（src/main/about.ts、src/main/config.ts；npm run check 通过）

## v0.0.9 (2026-09-08)

- [x] 自研界面（阶段 1：跑通主干）：主进程通信桥（fetch 转发 + 事件流转发）、界面骨架（会话列表、发消息、流式回复、审批卡）、「视图」菜单界面切换项；官方界面零改动。技术路线见 tech-architecture.md「UI 路线（2026-08-23 修订）」 ✅ 2026-08-23（npm run check 通过；RPC 信封格式已对真实引擎实测验证；界面交互待用户实际运行验证）
- [x] 发布工作流回写 CHANGELOG 必然非快进失败：CI 在 tag 检出上直接推 master，master 领先 tag 即被拒。改为切到远端 master 顶端重新生成后再推，消除结构性失败，仅剩秒级并发窗口。 ✅ 2026-08-22（.github/workflows/release.yml）
- [x] 标题栏菜单按 Esc / 再点按钮等关闭后高亮仍不消失（v0.0.8 实测）：popup 回调在这些无焦点变化的关闭路径下同样不触发，focus 兜底只在焦点转移时生效，此类路径全部无信号。改为 popup 处理器收拢至 menu.ts 并以 popupOpen 门控三路关闭信号（callback / webContents focus / 窗口 blur）；渲染层新增指针事件守卫，利用原生菜单开启期间页面收不到指针事件的特性，收到首个 mousemove/mousedown 即清除高亮；顺带移除粘滞状态下会引发幻影菜单的 onMouseEnter 悬停切换。 ✅ 2026-09-07（src/main/menu.ts、src/renderer/src/TitleBar.tsx；沙箱验证信号链路，类型检查与构建通过；真实手势待用户实际体验）
- [x] 升级 dsh 0.1.2-rc.1 后应用无法启动：新版引擎 Web 面强制 token 鉴权，就绪探测对根路径收到 401 即判未就绪，25 秒超时中止启动。改为按行解析引擎启动日志中的带 token Web 地址作为就绪探测与服务地址（解析失败退回裸地址以兼容旧版）；webview 由此携带 token 加载；主进程桥新增 token→cookie 握手并在 RPC POST 上携带。package.json 已恢复完整结构（scripts/devDependencies/build）并保留 0.1.2-rc.1 依赖；dsh-app-boot 的 junction 补丁已在上游重写修复，postinstall 移除。 ✅ 2026-09-08（src/main/harness.ts、src/main/dsh-bridge.ts、package.json；dev 启动实测就绪）
  - 遗留：自研桥对 0.1.2 的契约仍断裂——RPC 方法名全部 404（新 API 为 controller 形态）、events.mux/host 事件流无法连接（WS 携带 cookie+Origin 仍被挂断），官方界面不受影响（webview 自带 cookie 同源直连）。迁移工作归入下方「dsh 升级契约闸门」；期间原生自研界面的数据调用会失败，事件流重连日志每 3 秒报错属预期。
- [x] 自研桥迁移至 dsh 0.1.2 typert/gateway 契约（上一条遗留的落地）：一元调用为 POST /api/<endpoint>（如 session/list），载荷为具名参数包 {args} 信封；事件流统一为 /api/remote.mux 单条 WS（鉴权只认握手 cookie），桥内多路复用（open/cancel + item/error/end），断线自动重连并重放已开流；$events 逻辑流承载 api-session/* 通知与 approval/request、user-questions/request 瀑布，回执走 POST /api/$events/result；渲染层会话内容改用 session/follow 日志流（开场快照 + 实时事件），workspace.list 改由 workspace/follow 基线流承载，host.pickDirectory 改 directoryPicker/pick，session.prompt 增加 requestId。新增直接依赖 ws（remote.mux 握手需自定义 cookie 头）。 ✅ 2026-09-08（src/main/dsh-bridge.ts、src/renderer/src/native/*、src/shared/types.ts；wire 层已对独立引擎实测：session/list、session/create、session/prompt、session/cancel、workspace/follow、session/follow、$events ready 均返回 ok；各 endpoint 具名参数形态以 typert.remote-client.d.ts 为准——session/list 为 _request，其余带参端点为 request；界面交互待用户实际运行验证）

## v0.0.8 (2026-08-22)

- [x] 标题栏菜单点击外部空白关闭后按钮高亮不消失：Electron 原生菜单 popup 回调在"点击外部关闭"时不触发（electron#17341）。改为以菜单关闭后落点视图的 focus 事件作为确定关闭信号，通知标题栏清除高亮。 ✅ 2026-08-21（src/main/menu.js；待用户实际运行验证）
- [x] 自有代码迁移 TypeScript：主进程 / preload / 渲染层全量 .ts/.tsx，strict 类型检查纳入 npm run check 门禁，为后续自有插件对接 dsh 的 TS 类型契约打基础。 ✅ 2026-08-22（类型检查与构建通过；Windows 运行时行为无改动预期，待随下次实际使用回归）

## v0.0.7 (2026-08-22)

- [x] Windows 下 Agent 执行命令时不断闪现控制台窗口：Electron 主进程无控制台，dsh 子进程（pwsh 等）各自新建控制台窗口所致。方案：主进程启动时 AllocConsole 并立即 SW_HIDE 隐藏，让全部子进程继承该隐藏控制台；属青梧自有实现，不依赖 dsh 上游。 ✅ 2026-08-21（src/main/console.js，koffi 调用 Win32；待用户实际运行验证）

## v0.0.5 (2026-08-21)

- [x] 标题栏跟随系统明暗模式 ✅ 2026-08-21

## v0.0.4 (2026-08-21)

- [x] 标题栏与菜单栏整合（VSCode 风格自定义标题栏与原生 Snap Layout 贴靠） ✅ 2026-08-21
- [x] 系统托盘支持与关闭窗口最小化到托盘设置 ✅ 2026-08-21
- [x] 修复 Windows 任务栏右键菜单图标，绑定 AppUserModelId 并优化底层可执行文件名 ✅ 2026-08-21

## v0.0.2 (2026-08-20)

- [x] 优化生产打包配置，过滤 1.1 万个非运行时文件，解决 Windows 下解包卡顿耗时过长问题 ✅ 2026-08-20
- [x] 修复应用窗口菜单栏默认隐藏问题，调整为默认常驻顶部显示 ✅ 2026-08-20
- [x] 修复检查更新时 404 及底层网络报错直接弹窗问题，转为友好提示与脱敏信息 ✅ 2026-08-20
- [x] 清理关于对话框底部的多余文案描述 ✅ 2026-08-20
- [x] 更新应用桌面与窗口图标 ✅ 2026-08-20

## v0.0.1 (2026-08-20)

- [x] V0.0.1：Electron 桌面壳（拉起 dsh、加载官方 UI、干净启停、Windows 安装包） ✅ 2026-08-20
- [x] 启动后核实 dsh web 端口与参数、打包完整性（见 tech-architecture.md 待核实项） ✅ 2026-08-20
- [x] 原生菜单栏、关于对话框与手动检查更新机制（autoHideMenuBar、环境/引擎版本展示、InkMark 同款手动更新闭环） ✅ 2026-08-20
