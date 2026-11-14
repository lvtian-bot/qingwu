import { Notification } from "electron";
import type { WindowManager } from "./window";
import { tr } from "./i18n";
import { settings } from "./settings";

export interface TaskFinishedNotificationOptions {
  title?: string;
  body: string;
  sessionId?: string;
  type?: 'taskFinished' | 'pending';
}

/** 同时保留的活动通知上限：超出后丢弃最旧的一条，避免长期托盘运行时无限增长。 */
const MAX_LIVE_NOTIFICATIONS = 16;

export class NotificationManager {
  /**
   * 活动通知引用池。
   *
   * 系统通知显示后，点击回调挂在 Notification 实例上；若不持有引用，主进程
   * 空闲时的垃圾回收会回收该实例，Windows 通知中心里的残留条目就再也点不动
   * （应用在后台时最容易命中，前台因为回收晚而看起来正常）。因此必须持有到
   * 通知被点击或关闭为止。
   */
  private live: Notification[] = [];

  constructor(private windowManager: WindowManager) {}

  show(options: TaskFinishedNotificationOptions): void {
    const type = options.type ?? 'taskFinished';
    if (type === 'taskFinished' && settings.get("notifyOnTaskFinished") === false) {
      return;
    }
    if (type === 'pending' && settings.get("notifyOnPending") === false) {
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

    const icon = this.windowManager.getIcon?.() || this.windowManager.getIconPath();
    const notification = new Notification({
      title: options.title || tr("notify.taskFinished"),
      body: options.body,
      icon,
      silent: settings.get("notifySound") === false,
    });

    this.live.push(notification);
    while (this.live.length > MAX_LIVE_NOTIFICATIONS) {
      this.live.shift();
    }

    const release = () => {
      const index = this.live.indexOf(notification);
      if (index >= 0) this.live.splice(index, 1);
    };

    notification.on("click", () => {
      release();
      this.windowManager.focus();
      if (options.sessionId) {
        const win = this.windowManager.mainWindow;
        if (win && !win.isDestroyed()) {
          win.webContents.send("notification:navigate", options.sessionId);
        }
      }
    });

    // Windows 超时消失或用户手动关闭时释放引用；该事件不保证覆盖所有路径，
    // 因此另有数量上限兜底。
    notification.on("close", release);
    notification.on("failed", release);

    notification.show();
  }
}
