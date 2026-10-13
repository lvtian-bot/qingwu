import { app, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { CONFIG } from "./config";

function findCandidateShortcuts(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".lnk"))
      .map((e) => path.join(dirPath, e.name));
  } catch {
    return [];
  }
}

/**
 * 在 Windows 平台上自动迁移历史快捷方式的 AppUserModelId。
 * 针对历史版本（如 v0.2.8）未显式设置 AUMID 导致固定项被记录为默认标识（如 electron.app.青梧）的场景，
 * 启动时自动扫描任务栏固定项（支持枚举包含青梧 (2).lnk 等重复重命名项）与开始菜单快捷方式，
 * 对齐到统一的 CONFIG.appId（如 com.qingwu.desktop），避免用户升级后任务栏双图标。
 */
export function migrateAppShortcuts(
  targetAppId: string = CONFIG.appId || "com.qingwu.desktop",
): void {
  if (process.platform !== "win32") return;
  try {
    const appData = app.getPath("appData");
    const taskbarDir = path.join(
      appData,
      "Microsoft",
      "Internet Explorer",
      "Quick Launch",
      "User Pinned",
      "TaskBar",
    );
    const startMenuDir = path.join(
      appData,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
    );

    const candidates = [
      ...findCandidateShortcuts(taskbarDir),
      ...findCandidateShortcuts(startMenuDir),
    ];

    for (const candidate of candidates) {
      try {
        const details = shell.readShortcutLink(candidate);
        const isTargetQingwu =
          Boolean(details.target) &&
          path.basename(details.target).toLowerCase() === "qingwu.exe";
        if (isTargetQingwu && details.appUserModelId !== targetAppId) {
          const ok = shell.writeShortcutLink(candidate, "update", {
            ...details,
            appUserModelId: targetAppId,
          });
          if (ok) {
            console.log(
              `[Main] 自动迁移快捷方式 AppUserModelId 为 ${targetAppId}: ${candidate}`,
            );
          } else {
            console.warn(
              `[Main] 写入快捷方式 AppUserModelId 失败: ${candidate}`,
            );
          }
        }
      } catch (linkError) {
        console.warn("[Main] 读取/更新快捷方式失败:", candidate, linkError);
      }
    }
  } catch (err) {
    console.warn("[Main] 快捷方式迁移过程跳过:", err);
  }
}
