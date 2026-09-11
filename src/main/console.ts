import koffi from 'koffi';

/**
 * Windows 下为 GUI 主进程申请一个控制台并立即隐藏。
 *
 * Electron 是 GUI 程序，自身没有控制台；Windows 对无控制台父进程启动的
 * 控制台子进程会各新建一个控制台窗口，造成 Agent 执行命令时不断闪现黑窗。
 * 主进程持有一个隐藏控制台后，控制台子进程（dsh 拉起的 pwsh、taskkill 等）
 * 都会继承它，不再弹窗。
 *
 * 注意继承只发生在控制台子系统进程之间：GUI 子进程（electron.exe 自身）
 * 不继承父进程控制台，因此引擎必须用控制台子系统的 Node 运行时启动才能
 * 吃到这个隐藏控制台——见 harness.ts 的 resolveRuntime 与
 * docs/tech-architecture.md「引擎运行方式」。
 *
 * @returns 当前进程此刻是否已有控制台（从终端继承的，或本次新申请并已隐藏的）。
 *   调用方据此判断派生引擎时能否依赖继承；拿不到控制台时须用 windowsHide 兜底。
 */
export function acquireHiddenConsole(): boolean {
  if (process.platform !== 'win32') return false;

  let kernel32: ReturnType<typeof koffi.load> | null = null;
  let user32: ReturnType<typeof koffi.load> | null = null;
  try {
    kernel32 = koffi.load('kernel32.dll');
    user32 = koffi.load('user32.dll');
  } catch (err) {
    console.warn('[Main] 加载 Win32 API 失败，跳过控制台隐藏:', describeError(err));
    return false;
  }
  if (!kernel32 || !user32) return false;

  try {
    const allocConsole = kernel32.func('int __stdcall AllocConsole()');
    const getConsoleWindow = kernel32.func('void * __stdcall GetConsoleWindow()');
    const showWindow = user32.func('int __stdcall ShowWindow(void *hWnd, int nCmdShow)');

    // 已有控制台（如从终端启动）时 AllocConsole 返回 0：保留原控制台，
    // 不去隐藏用户自己的终端窗口。
    if (allocConsole() === 0) return Number(getConsoleWindow()) !== 0;

    const SW_HIDE = 0;
    const hwnd = getConsoleWindow();
    if (Number(hwnd) !== 0) showWindow(hwnd, SW_HIDE);
    return Number(hwnd) !== 0;
  } catch (err) {
    console.warn('[Main] 申请隐藏控制台失败，子进程可能闪现窗口:', describeError(err));
    return false;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
