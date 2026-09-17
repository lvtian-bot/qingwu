interface QuitEvent {
  preventDefault(): void;
}

interface QuitActions {
  stop: () => Promise<void>;
  setQuitting: (value: boolean) => void;
  finish: () => void;
  quit: () => void;
  failed: (error: unknown) => void;
}

/** Electron 不等待 async before-quit：先拦截，清理成功后仅放行一次退出。 */
export class AppLifecycle {
  requested = false;
  private ready = false;
  private pending: Promise<void> | null = null;

  constructor(private readonly actions: QuitActions) {}

  prepare(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.pending) return this.pending;
    this.requested = true;
    this.actions.setQuitting(true);
    this.pending = Promise.resolve()
      .then(() => this.actions.stop())
      .then(() => {
        this.actions.finish();
        this.ready = true;
      })
      .catch((error: unknown) => {
        this.actions.setQuitting(false);
        throw error;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  beforeQuit(event: QuitEvent): void {
    if (this.ready) return;
    event.preventDefault();
    if (this.pending) return;
    void this.prepare().then(this.actions.quit, this.actions.failed);
  }
}
