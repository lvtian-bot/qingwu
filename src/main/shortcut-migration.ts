import { app, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { CONFIG } from "./config";

function isCurrentInstallationTarget(targetPath?: string): boolean {
  if (!targetPath) return false;
  try {
    const normalizedTarget = path.normalize(targetPath).toLowerCase();
    const currentExec = path.normalize(process.execPath).toLowerCase();
    if (normalizedTarget === currentExec) return true;
    if (fs.existsSync(targetPath) && fs.existsSync(process.execPath)) {
      try {
        if (
          fs.realpathSync.native(targetPath).toLowerCase() ===
          fs.realpathSync.native(process.execPath).toLowerCase()
        ) {
          return true;
        }
      } catch {
        // realpath 解析失败时回落
      }
    }
    // 非打包模式下（测试/开发调试）容许匹配目标可执行文件名
    if (!app.isPackaged && path.basename(normalizedTarget) === "qingwu.exe") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function findCandidateShortcuts(
  dirPath: string,
  recursive = false,
): Promise<string[]> {
  try {
    if (!fs.existsSync(dirPath)) return [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".lnk")) {
        results.push(fullPath);
      } else if (entry.isDirectory() && recursive) {
        results.push(...(await findCandidateShortcuts(fullPath, recursive)));
      }
    }
    return results;
  } catch {
    return [];
  }
}

function isAlreadyMigrated(markerPath: string, targetAppId: string): boolean {
  try {
    if (!fs.existsSync(markerPath)) return false;
    const raw = fs.readFileSync(markerPath, "utf8");
    const data = JSON.parse(raw);
    return (
      data?.targetAppId === targetAppId &&
      data?.execPath === process.execPath &&
      data?.success === true
    );
  } catch {
    return false;
  }
}

/**
 * 在 Windows 平台上自动迁移历史快捷方式的 AppUserModelId。
 * 针对历史版本（如 v0.2.8）未显式设置 AUMID 导致固定项被记录为默认标识（如 electron.app.青梧）的场景，
 * 移出关键启动路径，在窗口创建后的空闲时段异步后台扫描：
 * 1. 通过持久化迁移标记避免每次启动重复全量扫描磁盘；
 * 2. 任务栏固定项（User Pinned\TaskBar 下所有 .lnk，含重命名副本）；
 * 3. 隐式固定项（User Pinned\ImplicitAppShortcuts\<hash> 下所有 .lnk，对齐 Chromium 隐式固定规范）；
 * 4. 开始菜单快捷方式（Start Menu\Programs 下所有 .lnk）。
 * 严格仅对指向当前青梧安装实例可执行文件的快捷方式执行 AUMID 更新，循环中让出主事件循环，
 * 且仅在全部成功时记录迁移完成标记，失败时保留下次重试。
 */
export async function migrateAppShortcuts(
  targetAppId: string = CONFIG.appId || "com.qingwu.desktop",
): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    const userData = app.getPath("userData");
    const markerPath = path.join(userData, ".shortcut-migration.json");
    if (isAlreadyMigrated(markerPath, targetAppId)) {
      return;
    }

    const appData = app.getPath("appData");
    const userPinnedDir = path.join(
      appData,
      "Microsoft",
      "Internet Explorer",
      "Quick Launch",
      "User Pinned",
    );
    const taskbarDir = path.join(userPinnedDir, "TaskBar");
    const implicitDir = path.join(userPinnedDir, "ImplicitAppShortcuts");
    const startMenuDir = path.join(
      appData,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
    );

    const candidates = [
      ...(await findCandidateShortcuts(taskbarDir)),
      ...(await findCandidateShortcuts(implicitDir, true)),
      ...(await findCandidateShortcuts(startMenuDir)),
    ];

    let hasFailures = false;

    for (const candidate of candidates) {
      try {
        const details = shell.readShortcutLink(candidate);
        if (
          isCurrentInstallationTarget(details.target) &&
          details.appUserModelId !== targetAppId
        ) {
          const ok = shell.writeShortcutLink(candidate, "update", {
            ...details,
            appUserModelId: targetAppId,
          });
          if (ok) {
            console.log(
              `[Main] 自动迁移快捷方式 AppUserModelId 为 ${targetAppId}: ${candidate}`,
            );
          } else {
            hasFailures = true;
            console.warn(
              `[Main] 写入快捷方式 AppUserModelId 失败: ${candidate}`,
            );
          }
        }
      } catch (linkError) {
        hasFailures = true;
        console.warn("[Main] 读取/更新快捷方式失败:", candidate, linkError);
      }
      // 让出事件循环，避免密集 I/O 阻塞主线程 IPC 与界面
      await new Promise((resolve) => setImmediate(resolve));
    }

    if (!hasFailures) {
      try {
        fs.writeFileSync(
          markerPath,
          JSON.stringify({
            targetAppId,
            execPath: process.execPath,
            success: true,
            timestamp: Date.now(),
          }),
        );
      } catch {
        // 标记写入失败不影响当次迁移
      }
    }
  } catch (err) {
    console.warn("[Main] 快捷方式迁移过程跳过:", err);
  }
}
