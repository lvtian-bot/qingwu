import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { UpdateState, UpdateStatus } from '../../shared/types';
import { useT } from './i18n';

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
  const t = useT();
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
    title = t('app.update.devModeTitle');
    description = t('app.update.devModeDesc');
    actions = (
      <button type="button" className="btn btn-primary" onClick={openReleases}>
        {t('app.update.openReleases')}
      </button>
    );
  } else if (status === 'checking' || status === 'idle') {
    title = t('app.update.checkingTitle');
    description = t('app.update.checkingDesc');
  } else if (status === 'latest') {
    title = t('app.update.latestTitle');
    description =
      state?.message || t('app.update.latestDesc', { version: currentVersion });
    actions = (
      <button type="button" className="btn btn-secondary" onClick={closeWindow}>
        {t('app.update.close')}
      </button>
    );
  } else if (status === 'available') {
    title = t('app.update.availableTitle', { version: latestVersion });
    description = t('app.update.availableDesc', {
      latest: latestVersion,
      current: currentVersion,
    });
    actions = (
      <>
        <button type="button" className="btn btn-secondary" onClick={closeWindow}>
          {t('app.update.remindLater')}
        </button>
        <button type="button" className="btn btn-primary" onClick={download}>
          {t('app.update.download')}
        </button>
      </>
    );
  } else if (status === 'downloading') {
    title = t('app.update.downloadingTitle', { version: latestVersion });
  } else if (status === 'downloaded') {
    title = t('app.update.readyTitle');
    description = t('app.update.readyDesc', { version: latestVersion });
    actions = (
      <>
        <button type="button" className="btn btn-secondary" onClick={closeWindow}>
          {t('app.update.installLater')}
        </button>
        <button type="button" className="btn btn-primary" onClick={install}>
          {t('app.update.restartAndInstall')}
        </button>
      </>
    );
  } else if (status === 'error') {
    title = t('app.update.errorTitle');
    description = state?.message || t('app.update.errorDesc');
    actions = (
      <>
        <button type="button" className="btn btn-secondary" onClick={openReleases}>
          {t('app.update.openReleases')}
        </button>
        <button type="button" className="btn btn-primary" onClick={check}>
          {t('app.update.retry')}
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
        <div className="update-footer">{t('app.update.footer', { version: currentVersion })}</div>
      </div>
    </div>
  );
}
