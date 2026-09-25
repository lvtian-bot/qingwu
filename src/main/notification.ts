import { Notification } from "electron";
import type { WindowManager } from "./window";
import { settings } from "./settings";

export interface TaskFinishedNotificationOptions {
  title?: string;
  body: string;
  sessionId?: string;
}

export class NotificationManager {
  constructor(private windowManager: WindowManager) {}

  show(options: TaskFinishedNotificationOptions): void {
    if (settings.get("notifyOnTaskFinished") === false) {
      return;
    }
    if (!Notification.isSupported()) {
      return;
    }

    const win = this.windowManager.mainWindow;
    // 仅在应用处于后台（窗口失焦、最小化或隐藏到托盘）时发送系统通知；前台使用中绝不弹窗打扰
    if (
      win &&
      !win.isDestroyed() &&
      win.isVisible() &&
      !win.isMinimized() &&
      win.isFocused()
    ) {
      return;
    }

    const icon = this.windowManager.getIconPath();
    const notification = new Notification({
      title: options.title || "任务执行完成",
      body: options.body,
      icon,
      silent: false,
    });

    notification.on("click", () => {
      this.windowManager.focus();
      if (options.sessionId) {
        const win = this.windowManager.mainWindow;
        if (win && !win.isDestroyed()) {
          win.webContents.send("notification:navigate", options.sessionId);
        }
      }
    });

    notification.show();
  }
}
