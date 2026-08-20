import { app, dialog, shell } from 'electron';
import { CONFIG } from './config.js';

export class UpdateManager {
  constructor(options = {}) {
    this.windowManager = options.windowManager || null;
    this.iconPath = options.iconPath || undefined;
    this.state = 'idle'; // idle | checking | available | downloading | downloaded | error
    this.latestVersion = null;
    this.downloadProgress = 0;
    this.updaterInstance = null;
  }

  async getAutoUpdater() {
    if (this.updaterInstance) {
      return this.updaterInstance;
    }

    try {
      const updaterModule = await import('electron-updater');
      const autoUpdater = updaterModule.autoUpdater || updaterModule.default?.autoUpdater;
      if (!autoUpdater) {
        throw new Error('未能初始化 electron-updater 模块');
      }

      // 手动更新核心原则：禁止静默下载，禁止退出时自动安装
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;

      this.updaterInstance = autoUpdater;
      this.bindUpdaterEvents(autoUpdater);
      return autoUpdater;
    } catch (err) {
      console.warn('[Update] 加载 electron-updater 失败:', err);
      return null;
    }
  }

  bindUpdaterEvents(autoUpdater) {
    autoUpdater.on('download-progress', (progressObj) => {
      this.downloadProgress = Math.round(progressObj.percent || 0);
      console.log(`[Update] 下载进度: ${this.downloadProgress}%`);
    });
  }

  getParentWindow() {
    return this.windowManager?.mainWindow || null;
  }

  async checkForUpdates() {
    const parentWindow = this.getParentWindow();
    const currentVersion = app.getVersion();

    // 开发环境防护
    if (!app.isPackaged) {
      await dialog.showMessageBox(parentWindow, {
        type: 'info',
        title: '检查更新',
        message: '当前处于开发调试模式',
        detail: `当前青梧版本: v${currentVersion}\n\n检查更新、差异下载与在线安装仅在正式打包的 Windows 发行版本中生效。\n您可以访问项目发布页查看最新版本。`,
        icon: this.iconPath,
        buttons: ['确定', '访问发布页'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }).then((res) => {
        if (res.response === 1) {
          shell.openExternal(CONFIG.repositoryUrl || 'https://github.com/deepseek-ai/dsh');
        }
      });
      return;
    }

    // 状态防重判断
    if (this.state === 'checking') {
      await dialog.showMessageBox(parentWindow, {
        type: 'info',
        title: '检查更新',
        message: '正在检查更新中',
        detail: '正在连接服务器获取最新版本信息，请稍候...',
        icon: this.iconPath,
        buttons: ['确定'],
      });
      return;
    }

    if (this.state === 'downloading') {
      await dialog.showMessageBox(parentWindow, {
        type: 'info',
        title: '正在下载更新',
        message: `新版本正在下载中 (已完成 ${this.downloadProgress}%)`,
        detail: '下载完成后将提示您确认安装，您可以在此期间继续使用应用。',
        icon: this.iconPath,
        buttons: ['确定'],
      });
      return;
    }

    if (this.state === 'downloaded') {
      const res = await dialog.showMessageBox(parentWindow, {
        type: 'info',
        title: '更新已就绪',
        message: `青梧 v${this.latestVersion} 已下载完成`,
        detail: '是否立即退出应用并安装更新？\n选择“稍后安装”将在本次会话中保留更新包，不会在退出时自动强制安装。',
        icon: this.iconPath,
        buttons: ['重启并安装', '稍后安装'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (res.response === 0 && this.updaterInstance) {
        this.updaterInstance.quitAndInstall();
      }
      return;
    }

    this.state = 'checking';

    try {
      const autoUpdater = await this.getAutoUpdater();
      if (!autoUpdater) {
        this.state = 'idle';
        await dialog.showMessageBox(parentWindow, {
          type: 'info',
          title: '检查更新',
          message: '暂无在线更新服务配置',
          detail: `当前版本: v${currentVersion}\n\n您可以前往官方发布页手动获取最新安装包。`,
          icon: this.iconPath,
          buttons: ['确定', '访问发布页'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        }).then((res) => {
          if (res.response === 1) {
            shell.openExternal(CONFIG.repositoryUrl || 'https://github.com/deepseek-ai/dsh');
          }
        });
        return;
      }

      const updateCheckResult = await autoUpdater.checkForUpdates();
      const updateInfo = updateCheckResult?.updateInfo;

      if (!updateInfo || updateInfo.version === currentVersion) {
        this.state = 'idle';
        await dialog.showMessageBox(parentWindow, {
          type: 'info',
          title: '检查更新',
          message: '当前已是最新版本',
          detail: `青梧 v${currentVersion} 目前已是最新版本，无需更新。\n内置引擎: @deepseek-ai/dsh ${CONFIG.harnessVersion || '0.1.0-rc.7'}`,
          icon: this.iconPath,
          buttons: ['确定'],
        });
        return;
      }

      // 发现新版本，不自动下载，先弹窗由用户确认
      this.state = 'available';
      this.latestVersion = updateInfo.version;

      let releaseNotes = '';
      if (typeof updateInfo.releaseNotes === 'string') {
        releaseNotes = updateInfo.releaseNotes;
      } else if (Array.isArray(updateInfo.releaseNotes)) {
        releaseNotes = updateInfo.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note || '')).join('\n');
      }

      const promptMsg = [
        `当前版本: v${currentVersion}`,
        `最新版本: v${updateInfo.version}`,
        releaseNotes ? `\n更新说明:\n${releaseNotes}` : '',
        '\n是否开始下载更新？',
      ].filter(Boolean).join('\n');

      const choice = await dialog.showMessageBox(parentWindow, {
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 青梧 v${updateInfo.version}`,
        detail: promptMsg,
        icon: this.iconPath,
        buttons: ['下载更新', '稍后提醒'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (choice.response === 0) {
        this.state = 'downloading';
        this.downloadProgress = 0;

        autoUpdater.downloadUpdate().then(() => {
          this.state = 'downloaded';
          dialog.showMessageBox(this.getParentWindow(), {
            type: 'info',
            title: '更新已就绪',
            message: `青梧 v${updateInfo.version} 下载完成`,
            detail: '新版本已准备就绪。是否立即重启并完成安装？\n选择“稍后安装”将在本次会话中保留更新包，不会在退出时自动强制安装。',
            icon: this.iconPath,
            buttons: ['重启并安装', '稍后安装'],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
          }).then((installChoice) => {
            if (installChoice.response === 0) {
              autoUpdater.quitAndInstall();
            }
          });
        }).catch((err) => {
          this.state = 'error';
          console.error('[Update] 下载更新包失败:', err);
          dialog.showMessageBox(this.getParentWindow(), {
            type: 'warning',
            title: '下载更新失败',
            message: '更新包下载遇到异常',
            detail: `原因: ${err.message || '网络连接中断或下载超时。'}\n\n您可以稍后重新尝试，或直接前往发布页下载。`,
            icon: this.iconPath,
            buttons: ['确定', '前往发布页'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          }).then((res) => {
            if (res.response === 1) {
              shell.openExternal(CONFIG.repositoryUrl || 'https://github.com/deepseek-ai/dsh');
            }
          });
        });
      } else {
        this.state = 'idle';
      }
    } catch (err) {
      this.state = 'error';
      console.error('[Update] 检查更新失败:', err);
      await dialog.showMessageBox(parentWindow, {
        type: 'warning',
        title: '检查更新失败',
        message: '未能获取最新版本信息',
        detail: `检查更新时遇到错误:\n${err.message || '网络连接异常或无法连接到更新服务器。'}\n\n您可以前往发布页手动查看最新版本。`,
        icon: this.iconPath,
        buttons: ['确定', '访问发布页'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }).then((res) => {
        if (res.response === 1) {
          shell.openExternal(CONFIG.repositoryUrl || 'https://github.com/deepseek-ai/dsh');
        }
      });
      this.state = 'idle';
    }
  }
}
