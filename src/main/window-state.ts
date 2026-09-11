import { app, screen } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from './config';

export interface WindowState {
  /** 还原（非最大化）状态下的窗口位置；缺省时由系统居中。 */
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

/** 窗口状态持久化：关闭时记录位置、尺寸与最大化状态，下次启动还原。 */
export class WindowStateManager {
  private readonly filePath = path.join(app.getPath('userData'), 'window-state.json');

  /** 读取上次保存的窗口状态；无记录、损坏或不在任何显示器内时回退默认值。 */
  load(): WindowState {
    const defaults: WindowState = {
      width: CONFIG.window.width,
      height: CONFIG.window.height,
      isMaximized: false,
    };
    try {
      if (!fs.existsSync(this.filePath)) return defaults;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<WindowState>;
      const rawWidth = typeof raw.width === 'number' ? raw.width : NaN;
      const rawHeight = typeof raw.height === 'number' ? raw.height : NaN;
      if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight)) return defaults;

      const state: WindowState = {
        width: this.clampMin(rawWidth, CONFIG.window.minWidth),
        height: this.clampMin(rawHeight, CONFIG.window.minHeight),
        isMaximized: raw.isMaximized === true,
      };
      const rawX = typeof raw.x === 'number' ? raw.x : NaN;
      const rawY = typeof raw.y === 'number' ? raw.y : NaN;
      if (
        Number.isFinite(rawX) &&
        Number.isFinite(rawY) &&
        this.isOnScreen({ x: rawX, y: rawY, width: state.width, height: state.height })
      ) {
        state.x = rawX;
        state.y = rawY;
      }
      return state;
    } catch (err) {
      console.error('[WindowState] 读取窗口状态失败:', err);
      return defaults;
    }
  }

  /** 保存窗口当前状态（最大化时记录还原边界），在窗口 close 时调用。 */
  save(win: BrowserWindow): void {
    try {
      if (win.isDestroyed()) return;
      const { x, y, width, height } = win.getNormalBounds();
      const state: WindowState = { x, y, width, height, isMaximized: win.isMaximized() };
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[WindowState] 保存窗口状态失败:', err);
    }
  }

  private clampMin(value: number, min: number): number {
    return Math.max(Math.floor(value), min);
  }

  /** 窗口至少与某个显示器相交，避免拔掉外接显示器后窗口出现在不可见区域。 */
  private isOnScreen(rect: Rectangle): boolean {
    return screen.getAllDisplays().some((display) => {
      const area = display.bounds;
      return (
        rect.x < area.x + area.width &&
        rect.x + rect.width > area.x &&
        rect.y < area.y + area.height &&
        rect.y + rect.height > area.y
      );
    });
  }
}
