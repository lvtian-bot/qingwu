import { SettingsRow } from "./settings-ui";
import type { DshSettingsController } from "./useDshSettings";

/** 权限分区：新会话默认执行权限预设。 */
export function PermissionsTab({ dsh }: { dsh: DshSettingsController }) {
  return (
    <>
      <div className="native-settings-panel-header">
        <h2>权限</h2>
        <p>配置写入底层引擎配置目录。</p>
      </div>

      {dsh.settingsMessage && (
        <div className="native-settings-alert">{dsh.settingsMessage}</div>
      )}

      <div className="native-settings-card">
        <SettingsRow
          label="新会话执行权限"
          desc="决定新建会话在执行命令与修改文件时的审批策略。"
        >
          <select
            className="native-settings-select"
            value={dsh.defaultPreset}
            onChange={(e) => void dsh.saveDefaultPreset(e.target.value)}
          >
            <option value="workspace-write">工作区内修改（推荐）</option>
            <option value="read-only">仅可查看</option>
            <option value="danger-full-access">完全权限</option>
          </select>
        </SettingsRow>
      </div>
    </>
  );
}
