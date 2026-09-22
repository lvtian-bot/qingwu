import { app, powerMonitor } from "electron";
import type { WebContents } from "electron";
import { redactSecrets } from "./logging";

const HEALTH_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

export interface DiagnosticSurface {
  label: string;
  webContents: WebContents;
}

interface SurfaceProbe {
  readyState: string;
  hidden: boolean;
  bodyChildren: number;
  rootChildren: number;
  width: number;
  height: number;
  background: string;
}

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
      timer.unref();
    }),
  ]);
}

async function probeSurface(surface: DiagnosticSurface): Promise<string> {
  const { label, webContents: contents } = surface;
  if (contents.isDestroyed()) return `${label}{destroyed=true}`;

  const script = `(() => {
    const body = document.body;
    const root = document.getElementById("root");
    const style = body ? getComputedStyle(body) : null;
    return {
      readyState: document.readyState,
      hidden: document.hidden,
      bodyChildren: body ? body.childElementCount : -1,
      rootChildren: root ? root.childElementCount : -1,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      background: style ? style.backgroundColor : ""
    };
  })()`;

  try {
    const probe = await withTimeout(
      contents.executeJavaScript(script, true) as Promise<SurfaceProbe>,
      PROBE_TIMEOUT_MS,
    );
    return `${label}{pid=${safeRendererPid(contents) ?? "-"},ready=${probe.readyState},hidden=${probe.hidden},body=${probe.bodyChildren},root=${probe.rootChildren},size=${probe.width}x${probe.height},bg=${probe.background || "-"}}`;
  } catch (error) {
    return `${label}{pid=${safeRendererPid(contents) ?? "-"},probeError=${redactSecrets(error)}}`;
  }
}

/**
 * 每分钟记录一次无内容界面心跳和进程内存。
 * 黑屏后可据此区分 DOM 消失、JS 卡死、渲染进程退出和合成/GPU 异常。
 */
export function startUiHealthMonitor(
  getSurfaces: () => readonly DiagnosticSurface[],
): () => void {
  let running = false;
  let stopped = false;

  const inspect = async () => {
    if (running || stopped || !app.isReady()) return;
    running = true;
    try {
      const states = await Promise.all(getSurfaces().map(probeSurface));
      console.log(`[Diagnostics] 界面心跳: ${states.join("; ")}`);
      logProcessSnapshot("ui-heartbeat");
    } finally {
      running = false;
    }
  };

  const initialTimer = setTimeout(() => void inspect(), 10_000);
  initialTimer.unref();
  const interval = setInterval(() => void inspect(), HEALTH_INTERVAL_MS);
  interval.unref();

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}
