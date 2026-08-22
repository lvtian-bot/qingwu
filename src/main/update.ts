import { app } from 'electron';
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import type { UpdateState } from '../shared/types';

function errorDetail(err: unknown): { message?: unknown; statusCode?: unknown } | null | undefined {
  return err as { message?: unknown; statusCode?: unknown } | null | undefined;
}

function isNoReleaseError(err: unknown): boolean {
  const detail = errorDetail(err);
  const message = String(detail?.message || detail || '');
  return (
    detail?.statusCode === 404 ||
    message.includes('404') ||
    message.includes('releases.atom') ||
    message.includes('Cannot find latest') ||
    message.includes('No published versions on GitHub')
  );
}

function errorText(err: unknown): string {
  const detail = errorDetail(err);
  const message = String(detail?.message || detail || '');
  if (/checksum|sha512|signature|integrity/i.test(message)) {
    return '更新包校验失败，请稍后重试或前往发布页手动下载。';
  }
  if (/network|fetch|connect|timeout|ENOTFOUND|ECONN|ETIMEDOUT|ERR_/i.test(message)) {
    return '网络连接异常，请检查网络后重试。';
  }
  const firstLine = message.split('\\n')[0].trim();
  if (firstLine && firstLine.length < 120) {
    return '更新遇到异常: ' + firstLine;
  }
  return '更新遇到异常，请稍后重试。';
}

function asVersion(payload: { version?: unknown } | null | undefined): string | null {
  const version = payload?.version;
  return typeof version === 'string' && version.trim() !== '' ? version.trim() : null;
}

export class UpdateService {
  private readonly currentVersion: string;
  private latestVersion: string;
  private readonly supported: boolean;
  private state: UpdateState;
  private adapter: AppUpdater | null = null;
  private adapterPromise: Promise<AppUpdater> | null = null;
  private checkPromise: Promise<UpdateState> | null = null;
  private resolveCheck: ((state: UpdateState) => void) | null = null;
  private downloadPromise: Promise<UpdateState> | null = null;
  private resolveDownload: ((state: UpdateState) => void) | null = null;
  onStateChange: ((state: UpdateState) => void) | null = null;

  constructor() {
    this.currentVersion = app.getVersion();
    this.latestVersion = this.currentVersion;
    this.supported = app.isPackaged && process.platform === 'win32';
    this.state = this.supported
      ? { status: 'idle', currentVersion: this.currentVersion }
      : { status: 'unsupported', currentVersion: this.currentVersion };
  }

  private setState(next: UpdateState): void {
    this.state = next;
    this.onStateChange?.(next);
  }

  private finishCheck(next: UpdateState): void {
    this.setState(next);
    this.resolveCheck?.(next);
    this.resolveCheck = null;
    this.checkPromise = null;
  }

  private finishDownload(next: UpdateState): void {
    this.setState(next);
    this.resolveDownload?.(next);
    this.resolveDownload = null;
    this.downloadPromise = null;
  }

  private async getAdapter(): Promise<AppUpdater> {
    if (this.adapter) return this.adapter;
    if (!this.adapterPromise) {
      this.adapterPromise = import('electron-updater')
        .then((module) => {
          const mod = module as unknown as {
            autoUpdater?: AppUpdater;
            default?: { autoUpdater?: AppUpdater };
          };
          const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
          if (!autoUpdater) {
            throw new Error('未能初始化 electron-updater 模块');
          }
          autoUpdater.autoDownload = false;
          autoUpdater.autoInstallOnAppQuit = false;
          this.bindEvents(autoUpdater);
          this.adapter = autoUpdater;
          return autoUpdater;
        })
        .catch((err: unknown) => {
          this.adapterPromise = null;
          throw err;
        });
    }
    return this.adapterPromise;
  }

  private bindEvents(autoUpdater: AppUpdater): void {
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      const version = asVersion(info) || this.currentVersion;
      this.latestVersion = version;
      this.finishCheck({
        status: 'available',
        currentVersion: this.currentVersion,
        latestVersion: version,
      });
    });
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      const version = asVersion(info) || this.currentVersion;
      this.latestVersion = version;
      this.finishCheck({
        status: 'latest',
        currentVersion: this.currentVersion,
        latestVersion: version,
      });
    });
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
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
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      const version = asVersion(info);
      if (version) this.latestVersion = version;
      this.finishDownload({
        status: 'downloaded',
        currentVersion: this.currentVersion,
        latestVersion: this.latestVersion,
      });
    });
    autoUpdater.on('error', (err: Error) => {
      const next: UpdateState = isNoReleaseError(err)
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

  getState(): UpdateState {
    return this.state;
  }

  async check(): Promise<UpdateState> {
    if (!this.supported) return this.state;
    if (this.checkPromise) return this.checkPromise;
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') {
      return this.state;
    }

    this.setState({ status: 'checking', currentVersion: this.currentVersion });
    this.checkPromise = new Promise<UpdateState>((resolve) => {
      this.resolveCheck = resolve;
    });
    try {
      const autoUpdater = await this.getAdapter();
      void autoUpdater.checkForUpdates().catch((err: unknown) => {
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

  async download(): Promise<UpdateState> {
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
    this.downloadPromise = new Promise<UpdateState>((resolve) => {
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

  install(): boolean {
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
