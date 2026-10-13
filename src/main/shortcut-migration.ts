import { app, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { CONFIG } from "./config";

/**
 * 在 Windows 平台上自动迁移历史快捷方式的 AppUserModelId。
 * 针对历史版本（如 v0.2.8）未显式设置 AUMID 导致固定项被记录为默认标识（如 electron.app.青梧）的场景，
 * 启动时自动将任务栏固定项与开始菜单快捷方式对齐到统一的 CONFIG.appId（如 com.qingwu.desktop），
 * 避免用户升级后因历史固定项 AUMID 不匹配而出现任务栏双图标。
 */
export function migrateAppShortcuts(
  targetAppId: string = CONFIG.appId || "com.qingwu.desktop",
): void {
  if (process.platform !== "win32") return;
  try {
    const appData = app.getPath("appData");
    const candidates = [
      path.join(
        appData,
        "Microsoft",
        "Internet Explorer",
        "Quick Launch",
        "User Pinned",
        "TaskBar",
        `${CONFIG.appName}.lnk`,
      ),
      path.join(
        appData,
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        `${CONFIG.appName}.lnk`,
      ),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const details = shell.readShortcutLink(candidate);
          const isTargetQingwu =
            Boolean(details.target) &&
            path.basename(details.target).toLowerCase() === "qingwu.exe";
          if (isTargetQingwu && details.appUserModelId !== targetAppId) {
            shell.writeShortcutLink(candidate, "update", {
              ...details,
              appUserModelId: targetAppId,
            });
            console.log(
              `[Main] 自动迁移快捷方式 AppUserModelId 为 ${targetAppId}: ${candidate}`,
            );
          }
        } catch (linkError) {
          console.warn("[Main] 读取/更新快捷方式失败:", candidate, linkError);
        }
      }
    }
  } catch (err) {
    console.warn("[Main] 快捷方式迁移过程跳过:", err);
  }
}
