import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function normalizeError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * 顶层兜底：渲染异常必须留下可恢复界面和诊断信息，不能再把整窗清成黑底。
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(value: unknown): AppErrorBoundaryState {
    return { error: normalizeError(value) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    window.qingwu.reportRendererError({
      kind: "react-render",
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack || undefined,
    });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main
        style={{
          minHeight: "100vh",
          boxSizing: "border-box",
          padding: "72px 24px 32px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#181818",
          color: "#f1f5f9",
          fontFamily:
            '"Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <section
          role="alert"
          style={{
            width: "min(560px, 100%)",
            padding: "28px",
            border: "1px solid #3f3f46",
            borderRadius: "14px",
            background: "#242426",
            boxShadow: "0 16px 48px rgba(0, 0, 0, 0.28)",
          }}
        >
          <h1 style={{ margin: "0 0 12px", fontSize: "20px" }}>
            青梧界面发生错误
          </h1>
          <p style={{ margin: "0 0 20px", color: "#a1a1aa", lineHeight: 1.7 }}>
            错误信息已写入应用日志。重新加载通常可以恢复当前窗口；如果问题重复出现，请保留发生时间以便继续排查。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "9px 18px",
              border: 0,
              borderRadius: "8px",
              background: "#3b82f6",
              color: "#fff",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            重新加载界面
          </button>
        </section>
      </main>
    );
  }
}
