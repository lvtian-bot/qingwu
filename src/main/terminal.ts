import { app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

let activeWorkspacePath: string | null = null;

export function setActiveWorkspacePath(workspacePath: string | null): void {
  activeWorkspacePath = workspacePath;
}

export function getActiveWorkspacePath(): string | null {
  return activeWorkspacePath;
}

export function resolveTargetPath(inputPath?: string | null): string {
  if (inputPath && typeof inputPath === 'string') {
    try {
      if (fs.existsSync(inputPath)) {
        const stat = fs.statSync(inputPath);
        return stat.isDirectory() ? inputPath : path.dirname(inputPath);
      }
    } catch {
      // 忽略无法 stat 的异常，退回到 fallback
    }
  }

  if (activeWorkspacePath && typeof activeWorkspacePath === 'string') {
    try {
      if (fs.existsSync(activeWorkspacePath)) {
        const stat = fs.statSync(activeWorkspacePath);
        return stat.isDirectory() ? activeWorkspacePath : path.dirname(activeWorkspacePath);
      }
    } catch {
      // 忽略
    }
  }

  return app.getPath('home');
}

function launchPowershell(cwd: string): { success: boolean; error?: string } {
  try {
    const proc = spawn(
      'powershell.exe',
      ['-NoExit', '-Command', `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'`],
      {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      }
    );
    proc.unref();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function launchWindowsTerminal(cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('wt.exe', ['-d', cwd], {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
    } catch {
      return resolve(false);
    }

    proc.on('error', () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.unref();
        } catch {
          // ignore
        }
        resolve(true);
      }
    }, 250);
  });
}

export async function openTerminal(
  targetPath?: string | null
): Promise<{ success: boolean; error?: string }> {
  const dir = resolveTargetPath(targetPath);

  if (process.platform === 'win32') {
    const wtSuccess = await launchWindowsTerminal(dir);
    if (wtSuccess) {
      return { success: true };
    }
    return launchPowershell(dir);
  }

  if (process.platform === 'darwin') {
    try {
      const proc = spawn('open', ['-a', 'Terminal', dir], {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Linux 或其他平台
  try {
    const proc = spawn('x-terminal-emulator', [], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
    return { success: true };
  } catch {
    try {
      const fallback = spawn('sh', ['-c', 'x-terminal-emulator || gnome-terminal || konsole || xterm'], {
        cwd: dir,
        detached: true,
        stdio: 'ignore',
      });
      fallback.unref();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export async function openPath(targetPath?: string | null): Promise<string> {
  const dir = resolveTargetPath(targetPath);
  return shell.openPath(dir);
}
