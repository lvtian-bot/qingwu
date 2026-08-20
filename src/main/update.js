import { app } from 'electron';

function isNoReleaseError(err) {
  const message = String(err?.message || err || '');
  return (
    err?.statusCode === 404 ||
    message.includes('404') ||
    message.includes('releases.atom') ||
    message.includes('Cannot find latest') ||
    message.includes('No published versions on GitHub')
  );
}

function errorText(err) {
  const message = String(err?.message || err || '');
  if (/checksum|sha512|signature|integrity/i.test(message)) {
    return '更新包校验失败，请稍后重试或前往发布页手动下载。';
  }
  if (/network|fetch|connect|timeout|ENOTFOUND|ECONN|ETIMEDOUT|ERR_/i.test(message)) {
    return '网络连接异常，请检查网络后重试。';
  }
  const firstLine = message.split('\n')[0].trim();
  if (firstLine && firstLine.length < 120) {
    return '更新遇到异常: ' + firstLine;
  }
  return '更新遇到异常，请稍后重试。';
}

function asVersion(payload) {
  const version = payload?.version;
  return typeof version === 'string' && version.trim() !== '' ? version.trim() : null;
}

export class UpdateService {
  constructor() {
    this.currentVersion = app.getVersion();
    this.latestVersion = this.currentVersion;
    this.supported = app.isPackaged && process.platform === 'win32';
    this.state = this.supported
      ? { status: 'idle', currentVersion: this.currentVersion }
      : { status: 'unsupported', currentVersion: this.currentVersion };
    this.adapter = null;
    this.adapterPromise = null;
    this.checkPromise = null;
    this.resolveCheck = null;
    this.downloadPromise = null;
    this.resolveDownload = null;
    this.onStateChange = null;
  }

  setState(next) {
    this.state = next;
    this.onStateChange?.(next);
  }

  finishCheck(next) {
    this.setState(next);
    this.resolveCheck?.(next);
    this.resolveCheck = null;
    this.checkPromise = null;
  }

  finishDownload(next) {
    this.setState(next);
    this.resolveDownload?.(next);
    this.resolveDownload = null;
    this.downloadPromise = null;
  }

  async getAdapter() {
    if (this.adapter) return this.adapter;
    if (!this.adapterPromise) {
      this.adapterPromise = import('electron-updater')
        .then((module) => {
          const autoUpdater = module.autoUpdater || module.default?.autoUpdater;
          if (!autoUpdater) {
            throw new Error('未能初始化 electron-updater 模块');
          }
          autoUpdater.autoDownload = false;
          autoUpdater.autoInstallOnAppQuit = false;
          this.bindEvents(autoUpdater);
          this.adapter = autoUpdater;
          return autoUpdater;
        })
        .catch((err) => {
          this.adapterPromise = null;
          throw err;
        });
    }
    return this.adapterPromise;
  }

  bindEvents(autoUpdater) {
    autoUpdater.on('update-available', (info) => {
      const version = asVersion(info) || this.currentVersion;
      this.latestVersion = version;
      this.finishCheck({
        status: 'available',
        currentVersion: this.currentVersion,
        latestVersion: version,
      });
    });
    autoUpdater.on('update-not-available', (info) => {
      const version = asVersion(info) || this.currentVersion;
      this.latestVersion = version;
      this.finishCheck({
        status: 'latest',
        currentVersion: this.currentVersion,
        latestVersion: version,
      });
    });
    autoUpdater.on('download-progress', (progress) => {
      if (typeof progress?.percent !== 'number') return;
      this.setState({
        status: 'downloading',
        currentVersion: this.currentVersion,
        latestVersion: this.latestVersion,
        percent: Math.min(100, Math.max(0, progress.percent)),
        transferred: Math.max(0, progress.transferred ?? 0),
        total: Math.max(0, progress.total ?? 0),
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      const version = asVersion(info);
      if (version) this.latestVersion = version;
      this.finishDownload({
        status: 'downloaded',
        currentVersion: this.currentVersion,
        latestVersion: this.latestVersion,
      });
    });
    autoUpdater.on('error', (err) => {
      const next = isNoReleaseError(err)
        ? {
            status: 'latest',
            currentVersion: this.currentVersion,
            latestVersion: this.currentVersion,
            message: '远程仓库暂无可用的新版本。',
          }
        : {
            status: 'error',
            currentVersion: this.currentVersion,
            message: errorText(err),
          };
      if (this.downloadPromise) this.finishDownload(next);
      else this.finishCheck(next);
    });
  }

  getState() {
    return this.state;
  }

  async check() {
    if (!this.supported) return this.state;
    if (this.checkPromise) return this.checkPromise;
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') {
      return this.state;
    }

    this.setState({ status: 'checking', currentVersion: this.currentVersion });
    this.checkPromise = new Promise((resolve) => {
      this.resolveCheck = resolve;
    });
    try {
      const autoUpdater = await this.getAdapter();
      void autoUpdater.checkForUpdates().catch((err) => {
        this.finishCheck({
          status: 'error',
          currentVersion: this.currentVersion,
          message: errorText(err),
        });
      });
    } catch (err) {
      this.finishCheck({
        status: 'error',
        currentVersion: this.currentVersion,
        message: errorText(err),
      });
    }
    return this.checkPromise;
  }

  async download() {
    if (!this.supported || this.state.status !== 'available') return this.state;
    if (this.downloadPromise) return this.downloadPromise;

    this.setState({
      status: 'downloading',
      currentVersion: this.currentVersion,
      latestVersion: this.latestVersion,
      percent: 0,
      transferred: 0,
      total: 0,
    });
    this.downloadPromise = new Promise((resolve) => {
      this.resolveDownload = resolve;
    });
    try {
      const autoUpdater = await this.getAdapter();
      void autoUpdater.downloadUpdate().catch(() => {
        // 下载错误统一由 error 事件收敛到状态机
      });
    } catch (err) {
      this.finishDownload({
        status: 'error',
        currentVersion: this.currentVersion,
        message: errorText(err),
      });
    }
    return this.downloadPromise;
  }

  install() {
    if (this.state.status !== 'downloaded' || !this.adapter) return false;
    try {
      this.adapter.quitAndInstall();
      return true;
    } catch {
      this.setState({
        status: 'error',
        currentVersion: this.currentVersion,
        message: '启动安装失败，请前往发布页手动下载。',
      });
      return false;
    }
  }
}
