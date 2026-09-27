import { useT } from "../i18n";
import { SettingsRow } from "./settings-ui";
import type { DshSettingsController } from "./useDshSettings";

/** 权限分区：新会话默认执行权限预设。 */
export function PermissionsTab({ dsh }: { dsh: DshSettingsController }) {
  const t = useT();
  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.permissions.title")}</h2>
        <p>
          <span title={t("settings.shared.engineBadgeTitle")}>
            {t("settings.shared.engineBadge")}
          </span>
          {t("settings.permissions.desc")}
        </p>
      </div>

      {dsh.settingsMessage && (
        <div className="native-settings-alert">{dsh.settingsMessage}</div>
      )}

      <div className="native-settings-card">
        <SettingsRow
          label={t("settings.permissions.defaultPreset.label")}
          desc={t("settings.permissions.defaultPreset.desc")}
        >
          <select
            className="native-settings-select"
            value={dsh.defaultPreset}
            onChange={(e) => void dsh.saveDefaultPreset(e.target.value)}
          >
            <option value="workspace-write">
              {t("settings.permissions.defaultPreset.workspaceWrite")}
            </option>
            <option value="read-only">
              {t("settings.permissions.defaultPreset.readOnly")}
            </option>
            <option value="danger-full-access">
              {t("settings.permissions.defaultPreset.fullAccess")}
            </option>
          </select>
        </SettingsRow>
      </div>
    </>
  );
}
