import { SettingsRow } from "./settings-ui";
import type { DshSettingsController } from "./useDshSettings";

/** 权限分区：新会话默认执行权限预设。 */
export function PermissionsTab({ dsh }: { dsh: DshSettingsController }) {
  return (
    <>
      <div className="native-settings-panel-header">
        <h2>权限</h2>
        <p>配置写入引擎配置目录，与 DeepSeek 界面共享。</p>
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
            <option value="standard">标准询问</option>
            <option value="elevated">完全授权</option>
            <option value="restricted">安全只读</option>
          </select>
        </SettingsRow>
      </div>
    </>
  );
}
