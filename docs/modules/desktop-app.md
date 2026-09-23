# 桌面应用

## 职责

- 主进程组合单实例、引擎、窗口、通信桥、托盘、菜单和更新；启动顺序是先准备用户数据路径与隐藏控制台，再等待 dsh 就绪，最后创建窗口并开启通信桥。
- `BrowserWindow` 装载青梧界面，`WebContentsView` 装载原样保留的 DeepSeek 界面。界面切换只改变视图显隐和焦点，两者共享同一 dsh；重载、缩放、菜单编辑操作必须作用于当前界面。
- 正常退出由 `AppLifecycle` 拦截 Electron 的 `before-quit`，等待本次引擎进程树清理完成后放行；关闭窗口是否隐藏到托盘由应用设置决定。引擎清理失败时保留重试入口，不能把失败当成已退出。
- 菜单动作由主进程统一分发；自绘弹层使用独立窗口，菜单内容与快捷键在共享文件中定义。`menu-layout.ts` 统一页面缩放、屏幕边界与投影留白的布局计算；弹层 session 与主页面隔离，避免继承主页面缩放。尺寸回报须匹配当前菜单和打开会话，防止旧弹层回报覆盖新尺寸。窗口更新、错误边界和脱敏诊断属于桌面应用，不承担引擎业务数据。

## 主要代码入口

- 启动与退出：`src/main/index.ts`、`app-lifecycle.ts`、`tray.ts`、`diagnostics.ts`、`logging.ts`。
- 窗口与界面切换：`src/main/window.ts`、`window-state.ts`、`src/renderer/src/main.tsx`、`TitleBar.tsx`、`AppErrorBoundary.tsx`。
- 菜单：`src/main/menu.ts`、`menu-popup.ts`、`src/shared/menu-data.ts`、`menu-layout.ts`、`src/renderer/src/MenuPopupView.tsx`、`MenuDropdown.tsx`。
- 更新：`src/main/update.ts`、`update-window.ts`、`src/renderer/src/UpdateWindow.tsx`。

## 易复发的技术约束

- **开发机启动即退且没有 JS 日志**：先排查残留实例占用单实例锁。若 `node_modules\electron\dist\electron.exe --version` 也以 `0x80000003` 退出、`app.log` 无新记录，而 Node 构建正常，主进程 JS 尚未运行；曾确认项目目录的 Windows Low 强制完整性标签会造成这一现象。用 `icacls <项目根目录>` 核对标签和拒绝权限，确认后将完整性标签恢复为 Medium，并只移除异常的显式拒绝项；不要按渲染代码或 dsh 故障排查。
