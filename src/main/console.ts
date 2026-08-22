import koffi from 'koffi';

/**
 * Windows 下为 GUI 主进程申请一个控制台并立即隐藏。
 *
 * Electron 是 GUI 程序，自身没有控制台；Windows 对无控制台父进程启动的
 * 控制台子进程（dsh 拉起的 pwsh、taskkill 等）会各新建一个控制台窗口，
 * 造成 Agent 执行命令时不断闪现黑窗。主进程持有一个隐藏控制台后，
 * 所有子进程都会继承它，不再弹窗。
 *
 * 开发模式从终端启动时进程已带控制台，AllocConsole 会失败，此时跳过。
 */
export function acquireHiddenConsole() {
  if (process.platform !== 'win32') return;

  let kernel32: ReturnType<typeof koffi.load> | null = null;
  let user32: ReturnType<typeof koffi.load> | null = null;
  try {
    kernel32 = koffi.load('kernel32.dll');
    user32 = koffi.load('user32.dll');
  } catch (err) {
    console.warn('[Main] 加载 Win32 API 失败，跳过控制台隐藏:', describeError(err));
    return;
  }
  if (!kernel32 || !user32) return;

  try {
    const allocConsole = kernel32.func('int __stdcall AllocConsole()');
    const getConsoleWindow = kernel32.func('void * __stdcall GetConsoleWindow()');
    const showWindow = user32.func('int __stdcall ShowWindow(void *hWnd, int nCmdShow)');

    // 已有控制台（如从终端启动）时 AllocConsole 返回 0，无需处理。
    if (allocConsole() === 0) return;

    const SW_HIDE = 0;
    const hwnd = getConsoleWindow();
    if (hwnd) showWindow(hwnd, SW_HIDE);
  } catch (err) {
    console.warn('[Main] 申请隐藏控制台失败，子进程可能闪现窗口:', describeError(err));
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
