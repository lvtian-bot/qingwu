import { app, powerMonitor } from "electron";
import type { WebContents } from "electron";
import { redactSecrets } from "./logging";

/** 诊断日志只保留页面位置，不记录可能承载鉴权信息的查询参数或片段。 */
export function sanitizeDiagnosticUrl(rawUrl: string): string {
  if (!rawUrl) return "(empty)";
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "data:") return "data:[omitted]";
    if (url.protocol === "file:") {
      const lastSegment = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
      return `file:///${lastSegment}`;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return redactSecrets(rawUrl).slice(0, 200);
  }
}

function safeRendererPid(contents: WebContents): number | null {
  try {
    return contents.isDestroyed() ? null : contents.getOSProcessId();
  } catch {
    return null;
  }
}

export function formatProcessMetrics(
  metrics: ReturnType<typeof app.getAppMetrics>,
): string {
  return metrics
    .map((metric) => {
      const workingSetMb = (metric.memory.workingSetSize / 1024).toFixed(1);
      const privateMb =
        metric.memory.privateBytes === undefined
          ? "n/a"
          : (metric.memory.privateBytes / 1024).toFixed(1);
      const name = metric.name || metric.serviceName || "-";
      return `${metric.type}:${name}:pid=${metric.pid}:ws=${workingSetMb}MB:private=${privateMb}MB`;
    })
    .join(", ");
}

function logProcessSnapshot(reason: string): void {
  if (!app.isReady()) return;
  try {
    console.log(
      `[Diagnostics] 进程快照 (${reason}): ${formatProcessMetrics(app.getAppMetrics())}`,
    );
  } catch (error) {
    console.warn(
      `[Diagnostics] 读取进程快照失败 (${reason}):`,
      redactSecrets(error),
    );
  }
}

/** 安装应用级诊断：覆盖 GPU、网络等非渲染 Chromium 子进程。 */
export function setupApplicationDiagnostics(): void {
  const systemVersion =
    typeof process.getSystemVersion === "function"
      ? process.getSystemVersion()
      : process.version;
  console.log(
    `[Diagnostics] 运行环境: Electron ${process.versions.electron || "-"}, Chromium ${process.versions.chrome || "-"}, Node ${process.versions.node}, OS ${process.platform} ${systemVersion}`,
  );

  app.on("gpu-info-update", () => {
    console.log(
      `[Diagnostics] GPU 状态更新: hardwareAcceleration=${app.isHardwareAccelerationEnabled()}, features=${JSON.stringify(app.getGPUFeatureStatus())}`,
    );
    logProcessSnapshot("gpu-info-update");
  });

  app.on("child-process-gone", (_event, details) => {
    console.error(
      `[Diagnostics] Chromium 子进程退出: type=${details.type}, name=${details.name || details.serviceName || "-"}, reason=${details.reason}, exitCode=${details.exitCode}`,
    );
    logProcessSnapshot("child-process-gone");
  });

  void app.whenReady().then(() => {
    powerMonitor.on("suspend", () =>
      console.log("[Diagnostics] 系统即将休眠"),
    );
    powerMonitor.on("resume", () => {
      console.log("[Diagnostics] 系统已从休眠恢复");
      logProcessSnapshot("system-resume");
    });
    powerMonitor.on("lock-screen", () =>
      console.log("[Diagnostics] 屏幕已锁定"),
    );
    powerMonitor.on("unlock-screen", () => {
      console.log("[Diagnostics] 屏幕已解锁");
      logProcessSnapshot("screen-unlock");
    });
  });
}

/** 给每个界面挂载加载、崩溃和卡死事件；不读取或输出页面正文。 */
export function observeWebContents(
  label: string,
  contents: WebContents,
): void {
  console.log(
    `[Diagnostics] ${label} WebContents 已创建: id=${contents.id}, type=${contents.getType()}`,
  );

  contents.on("did-finish-load", () => {
    console.log(
      `[Diagnostics] ${label} 页面加载完成: pid=${safeRendererPid(contents) ?? "-"}, url=${sanitizeDiagnosticUrl(contents.getURL())}`,
    );
  });

  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame) return;
      console.error(
        `[Diagnostics] ${label} 页面加载失败: code=${errorCode}, description=${redactSecrets(errorDescription)}, url=${sanitizeDiagnosticUrl(validatedUrl)}`,
      );
    },
  );

  contents.on("preload-error", (_event, preloadPath, error) => {
    console.error(
      `[Diagnostics] ${label} preload 失败: file=${preloadPath.split(/[\\/]/).at(-1) || "-"}, error=${redactSecrets(error)}`,
    );
  });

  contents.on("render-process-gone", (_event, details) => {
    console.error(
      `[Diagnostics] ${label} 渲染进程退出: reason=${details.reason}, exitCode=${details.exitCode}, url=${sanitizeDiagnosticUrl(contents.getURL())}`,
    );
    logProcessSnapshot(`${label}:render-process-gone`);
  });

  contents.on("unresponsive", () => {
    console.warn(
      `[Diagnostics] ${label} 页面无响应: pid=${safeRendererPid(contents) ?? "-"}, url=${sanitizeDiagnosticUrl(contents.getURL())}`,
    );
    logProcessSnapshot(`${label}:unresponsive`);
  });

  contents.on("responsive", () => {
    console.log(
      `[Diagnostics] ${label} 页面恢复响应: pid=${safeRendererPid(contents) ?? "-"}`,
    );
  });
}
