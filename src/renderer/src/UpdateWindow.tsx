import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { UpdateState, UpdateStatus } from '../../shared/types';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return '' + Math.round(value) + ' B';
  if (value < 1024 * 1024) return '' + (value / 1024).toFixed(1) + ' KB';
  return '' + (value / (1024 * 1024)).toFixed(1) + ' MB';
}

function StatusIcon({ status }: { status: UpdateStatus }) {
  if (status === 'checking' || status === 'downloading' || status === 'idle') {
    return <div className="icon-spinner" aria-hidden="true" />;
  }
  if (status === 'latest' || status === 'downloaded') {
    return (
      <div className="icon-circle icon-success" aria-hidden="true">
        ✓
      </div>
    );
  }
  if (status === 'available') {
    return (
      <div className="icon-circle icon-info" aria-hidden="true">
        ↓
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="icon-circle icon-warning" aria-hidden="true">
        !
      </div>
    );
  }
  return (
    <div className="icon-circle icon-muted" aria-hidden="true">
      i
    </div>
  );
}

export function UpdateWindow() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    let active = true;
    const removeListener = window.qingwu.onUpdateState((nextState) => {
      if (active) setState(nextState);
    });
    void window.qingwu.getUpdateState().then((currentState) => {
      if (!active) return;
      setState(currentState);
      const status = currentState?.status;
      if (status === 'idle' || status === 'latest' || status === 'error') {
        void window.qingwu.checkForUpdates().then((nextState) => {
          if (active) setState(nextState);
        });
      }
    });
    return () => {
      active = false;
      removeListener();
    };
  }, []);

  const status = state?.status ?? 'checking';
  const currentVersion = state?.currentVersion ?? '';
  const latestVersion = state?.latestVersion ?? '';

  const check = () => {
    void window.qingwu.checkForUpdates().then(setState);
  };
  const download = () => {
    void window.qingwu.downloadUpdate().then(setState);
  };
  const install = () => {
    void window.qingwu.installUpdate();
  };
  const openReleases = () => {
    void window.qingwu.openReleases();
  };
  const closeWindow = () => {
    window.close();
  };

  let title = '';
  let description = '';
  let actions: ReactNode = null;

  if (status === 'unsupported') {
    title = '开发调试模式';
    description =
      '当前处于开发调试模式，在线更新仅在正式打包的 Windows 发行版本中生效。您可以前往发布页查看最新版本。';
    actions = (
      <button type="button" className="btn btn-primary" onClick={openReleases}>
        访问发布页
      </button>
    );
  } else if (status === 'checking' || status === 'idle') {
    title = '正在检查更新';
    description = '正在连接服务器获取最新版本信息…';
  } else if (status === 'latest') {
    title = '已是最新版本';
    description =
      state?.message || '青梧 v' + currentVersion + ' 目前已是最新版本，无需更新。';
    actions = (
      <button type="button" className="btn btn-secondary" onClick={closeWindow}>
        关闭
      </button>
    );
  } else if (status === 'available') {
    title = '发现新版本 v' + latestVersion;
    description = '最新版本 v' + latestVersion + '，当前版本 v' + currentVersion + '。';
    actions = (
      <>
        <button type="button" className="btn btn-secondary" onClick={closeWindow}>
          稍后提醒
        </button>
        <button type="button" className="btn btn-primary" onClick={download}>
          下载更新
        </button>
      </>
    );
  } else if (status === 'downloading') {
    title = '正在下载 v' + latestVersion;
  } else if (status === 'downloaded') {
    title = '更新已就绪';
    description = 'v' + latestVersion + ' 已下载完成，重启应用后完成安装。';
    actions = (
      <>
        <button type="button" className="btn btn-secondary" onClick={closeWindow}>
          稍后安装
        </button>
        <button type="button" className="btn btn-primary" onClick={install}>
          重启并安装
        </button>
      </>
    );
  } else if (status === 'error') {
    title = '更新遇到问题';
    description = state?.message || '未能获取版本信息，请稍后重试。';
    actions = (
      <>
        <button type="button" className="btn btn-secondary" onClick={openReleases}>
          访问发布页
        </button>
        <button type="button" className="btn btn-primary" onClick={check}>
          重试
        </button>
      </>
    );
  }

  return (
    <div className="update-window-wrapper">
      <div className="update-card">
        <StatusIcon status={status} />
      <div className="update-title">{title}</div>
      <div className="update-desc">{description}</div>
      {status === 'downloading' && (
        <div className="update-progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: Math.round(state?.percent ?? 0) + '%' }}
            />
          </div>
          <div className="progress-text">
            {Math.round(state?.percent ?? 0)}% · {formatBytes(state?.transferred ?? 0)} /{' '}
            {formatBytes(state?.total ?? 0)}
          </div>
        </div>
      )}
        <div className="update-actions">{actions}</div>
        <div className="update-footer">青梧 v{currentVersion}</div>
      </div>
    </div>
  );
}
