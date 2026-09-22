import "./paths";
import path from "node:path";
import { app, dialog, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { acquireHiddenConsole } from "./console";
import { HarnessManager } from "./harness";
import { WindowManager } from "./window";
import { createApplicationMenu } from "./menu";
import { MenuPopupManager } from "./menu-popup";
import { setupAboutPanel } from "./about";
import { UpdateService } from "./update";
import { UpdateWindowManager } from "./update-window";
import { TrayManager } from "./tray";
import { DshBridge } from "./dsh-bridge";
import { settings } from "./settings";
import { CONFIG } from "./config";
import { AppLifecycle } from "./app-lifecycle";
import { setupFileLogging, redactSecrets } from "./logging";
import { openTerminal, openPath, showItemInFolder, setActiveWorkspacePath } from "./terminal";
import { setupApplicationDiagnostics } from "./diagnostics";
import type { RendererErrorReport, UiMode } from "../shared/types";

setupFileLogging(path.join(app.getPath("userData"), "logs"));
setupApplicationDiagnostics();

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log("[Main] 已有应用实例正在运行，退出当前进程");
  app.quit();
} else {
  const hasConsole = acquireHiddenConsole();
  app.setAppUserModelId(CONFIG.appId || "com.qingwu.desktop");
  const windowManager = new WindowManager();
  const harnessManager = new HarnessManager({ hasConsole });
  const updateService = new UpdateService();
  const updateWindowManager = new UpdateWindowManager(
    () => windowManager.mainWindow,
  );
  const trayManager = new TrayManager(windowManager, updateWindowManager);
  const dshBridge = new DshBridge(
    () => harnessManager.getWebUrl(),
    () => windowManager.mainWindow,
  );
  const showCleanupFailure = async (error: unknown) => {
    console.error("[Main] 引擎清理失败:", redactSecrets(error));
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "暂时无法退出青梧",
      message:
        "后台引擎尚未完成清理，可以重试退出。保留应用后，可从托盘选择退出；没有托盘时重新打开青梧可再次尝试退出。",
      detail: redactSecrets(error),
      buttons: ["重试退出", "保留应用"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) app.quit();
  };
  const lifecycle = new AppLifecycle({
    stop: () => harnessManager.stop(),
    setQuitting: (value) => {
      windowManager.isQuitting = value;
    },
    finish: () => {
      trayManager.destroy();
      dshBridge.stop();
    },
    quit: () => app.quit(),
    failed: showCleanupFailure,
  });

  updateService.onStateChange = (state) => updateWindowManager.sendState(state);

  app.on("second-instance", () => {
    if (lifecycle.requested && !windowManager.mainWindow) {
      app.quit();
      return;
    }
    windowManager.focus();
  });

  const isUpdateWindowSender = (event: IpcMainInvokeEvent) =>
    updateWindowManager.isSender(event);

  const trimDiagnostic = (value: unknown, maxLength: number): string | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    return redactSecrets(String(value)).slice(0, maxLength);
  };

  ipcMain.on(
    "diagnostics:renderer-error",
    (event, report: RendererErrorReport) => {
      if (
        !windowManager.mainWindow ||
        windowManager.mainWindow.isDestroyed() ||
        event.sender !== windowManager.mainWindow.webContents
      ) {
        return;
      }
      console.error(
        "[Renderer] 青梧界面未捕获错误:",
        JSON.stringify({
          kind: trimDiagnostic(report?.kind, 40),
          message: trimDiagnostic(report?.message, 2_000),
          stack: trimDiagnostic(report?.stack, 8_000),
          componentStack: trimDiagnostic(report?.componentStack, 8_000),
          source: trimDiagnostic(report?.source, 500),
          line: Number.isFinite(report?.line) ? report.line : undefined,
          column: Number.isFinite(report?.column) ? report.column : undefined,
        }),
      );
    },
  );

  ipcMain.handle("update:getState", (event) =>
    isUpdateWindowSender(event) ? updateService.getState() : null,
  );
  ipcMain.handle("update:check", (event) =>
    isUpdateWindowSender(event) ? updateService.check() : null,
  );
  ipcMain.handle("update:download", (event) =>
    isUpdateWindowSender(event) ? updateService.download() : null,
  );
  ipcMain.handle("update:install", async (event) => {
    if (
      !isUpdateWindowSender(event) ||
      updateService.getState().status !== "downloaded"
    ) {
      return false;
    }
    // 安装器可能先派生进程再触发 app.quit，必须在调用它之前完成清理。
    try {
      await lifecycle.prepare();
      const installed = updateService.install();
      if (!installed) app.quit();
      return installed;
    } catch (error) {
      void showCleanupFailure(error);
      return false;
    }
  });
  ipcMain.handle("update:openReleases", (event) => {
    if (isUpdateWindowSender(event)) {
      shell.openExternal(CONFIG.repositoryUrl + "/releases");
    }
  });

  ipcMain.handle("titlebar:getTitle", () => {
    return windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()
      ? windowManager.mainWindow.getTitle()
      : CONFIG.appName;
  });
  ipcMain.handle("titlebar:openUpdateWindow", () => {
    updateWindowManager.open();
  });
  ipcMain.handle("titlebar:showAbout", () => {
    setupAboutPanel();
    app.showAboutPanel();
  });

  ipcMain.handle(
    "dsh:call",
    async (_event, endpoint: string, payload: unknown) => {
      const result = await dshBridge.call(endpoint, payload);
      return result;
    },
  );
  ipcMain.handle("dsh:stream-open", (_event, { endpoint, payload }) =>
    dshBridge.openStream(endpoint, payload),
  );
  ipcMain.handle("dsh:stream-cancel", (_event, { streamId }) => {
    dshBridge.cancelStream(streamId);
  });
  ipcMain.handle("dsh:event-result", (_event, { clientId, eventId, outcome }) =>
    dshBridge.eventResult(clientId, eventId, outcome),
  );
  ipcMain.handle("dsh:getConnectionStatus", () => dshBridge.isConnected?.() ?? false);
  ipcMain.handle("dsh:reconnect", () => {
    dshBridge.reconnect?.();
  });

  ipcMain.handle("ui:getMode", () => settings.get("uiMode"));
  ipcMain.handle("ui:setMode", (_event, mode: UiMode) => {
    if (mode !== "official" && mode !== "native") return;
    settings.set("uiMode", mode);
    windowManager.applyUiMode(mode);
  });

  ipcMain.handle("appSettings:get", () => settings.getAll());
  ipcMain.handle(
    "appSettings:set",
    (_event, patch: Partial<import("../shared/types").AppSettings>) => {
      const updated = settings.update(patch);
      if (patch.uiMode && (patch.uiMode === "official" || patch.uiMode === "native")) {
        windowManager.applyUiMode(patch.uiMode);
      }
      windowManager.mainWindow?.webContents.send("appSettings:changed", updated);
      return updated;
    },
  );
  settings.onChange((_key, _value, all) => {
    windowManager.mainWindow?.webContents.send("appSettings:changed", all);
  });
  ipcMain.handle("appSettings:openUserData", () =>
    shell.openPath(app.getPath("userData")),
  );

  ipcMain.handle("workspace:openTerminal", (_event, targetPath?: string) =>
    openTerminal(targetPath),
  );
  ipcMain.handle("workspace:openPath", (_event, targetPath?: string) =>
    openPath(targetPath),
  );
  ipcMain.handle("workspace:showItemInFolder", (_event, targetPath: string) =>
    showItemInFolder(targetPath),
  );
  ipcMain.handle("workspace:setActivePath", (_event, targetPath: string | null) => {
    setActiveWorkspacePath(targetPath);
  });

  app.whenReady().then(async () => {
    try {
      if (lifecycle.requested) return;
      console.log("[Main] 青梧应用启动中...");
      setupAboutPanel();
      // 启动期间也保留退出入口，清理失败时不让应用成为不可操作的后台实例。
      trayManager.init(windowManager.getIconPath());

      await harnessManager.start();
      if (lifecycle.requested) return;

      const serviceUrl = harnessManager.getWebUrl();
      windowManager.createWindow(serviceUrl);
      dshBridge.start();

      // 菜单动作统一在主进程分发（自绘弹层经 menu-popup:action 上行）。
      const handleMenuAction = (actionId: string) => {
        switch (actionId) {
          case "switchUiMode": {
            const next: UiMode =
              settings.get("uiMode") === "native" ? "official" : "native";
            settings.set("uiMode", next);
            windowManager.applyUiMode(next);
            break;
          }
          case "toggleCloseToTray": {
            settings.set("closeToTray", !settings.get("closeToTray"));
            break;
          }
          case "openTerminal": {
            void openTerminal();
            break;
          }
          case "openFolder": {
            void openPath();
            break;
          }
          case "settings": {
            windowManager.mainWindow?.webContents.send("qingwu:open-settings");
            break;
          }
          case "reload": {
            windowManager.getTargetWebContents()?.reload();
            break;
          }
          case "reloadIgnoringCache": {
            windowManager.getTargetWebContents()?.reloadIgnoringCache();
            break;
          }
          case "toggleFullScreen": {
            const win = windowManager.mainWindow;
            if (win && !win.isDestroyed()) {
              win.setFullScreen(!win.isFullScreen());
            }
            break;
          }
          case "zoomIn":
          case "zoomOut":
          case "resetZoom": {
            const wc = windowManager.getTargetWebContents();
            if (wc) {
              const current = wc.getZoomLevel();
              wc.setZoomLevel(
                actionId === "zoomIn"
                  ? current + 0.5
                  : actionId === "zoomOut"
                    ? current - 0.5
                    : 0,
              );
            }
            break;
          }
          case "toggleDevTools": {
            windowManager.getTargetWebContents()?.toggleDevTools();
            break;
          }
          case "undo":
          case "redo":
          case "cut":
          case "copy":
          case "paste":
          case "selectAll":
          case "delete": {
            windowManager.getTargetWebContents?.()?.[actionId]?.();
            break;
          }
          case "checkForUpdates": {
            updateWindowManager.open();
            break;
          }
          case "about": {
            setupAboutPanel();
            app.showAboutPanel();
            break;
          }
          case "openGitHub": {
            shell.openExternal(CONFIG.repositoryUrl);
            break;
          }
          case "quit": {
            app.quit();
            break;
          }
        }
      };

      const menuPopupManager = new MenuPopupManager({
        getMainWindow: () => windowManager.mainWindow,
        onAction: handleMenuAction,
      });
      windowManager.mainWindow?.on("closed", () => menuPopupManager.destroy());

      createApplicationMenu({
        onCheckForUpdates: () => updateWindowManager.open(),
        getTargetWebContents: () => windowManager.getTargetWebContents(),
        getMainWindow: () => windowManager.mainWindow,
        onSwitchUiMode: () => {
          const next: UiMode =
            settings.get("uiMode") === "native" ? "official" : "native";
          settings.set("uiMode", next);
          windowManager.applyUiMode(next);
        },
        onOpenTerminal: () => {
          void openTerminal();
        },
        onOpenFolder: () => {
          void openPath();
        },
      });

      harnessManager.onUnexpectedExit((code, signal) => {
        console.error(`[Main] 引擎异常退出: code=${code}, signal=${signal}`);
        windowManager.showErrorMessage(
          "服务连接已中断",
          `后台引擎服务异常退出 (退出码: ${code || "无"}, 信号: ${signal || "无"})。请尝试重启应用或重新连接。`,
        );
      });
    } catch (err) {
      if (lifecycle.requested) return;
      console.error("[Main] 启动失败:", redactSecrets(err));
      dialog.showErrorBox(
        "青梧启动失败",
        `无法启动内置引擎服务:\n${redactSecrets(err)}\n\n应用即将退出。`,
      );
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => lifecycle.beforeQuit(event));
}
