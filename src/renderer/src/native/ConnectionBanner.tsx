/** 引擎断连提示横条：主界面与设置页共用，含手动重连按钮。 */
export function ConnectionBanner({
  reconnecting,
  onReconnect,
}: {
  /** 手动重连进行中（按钮禁用并显示进行文案）。 */
  reconnecting: boolean;
  onReconnect: () => void;
}) {
  return (
    <div className="native-connection-banner" role="alert">
      <span className="native-connection-icon">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </span>
      <span className="native-connection-text">
        与 DeepSeek Harness 引擎连接中断，正在尝试重新连接…
      </span>
      <button
        type="button"
        className="native-connection-retry-btn"
        disabled={reconnecting}
        onClick={onReconnect}
      >
        {reconnecting ? "正在重连…" : "立即重试"}
      </button>
    </div>
  );
}
