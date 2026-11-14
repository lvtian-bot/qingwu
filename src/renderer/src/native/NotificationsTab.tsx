import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../../shared/types";
import { useT } from "../i18n";
import { SettingsRow, SettingsSwitch } from "./settings-ui";

/** 通知分区：控制智能体后台运行时的桌面提醒与声音偏好。 */
export function NotificationsTab() {
  const t = useT();
  const [appSettings, setAppSettings] = useState<AppSettings>({
    closeToTray: true,
    collapseProcess: false,
    transcriptView: "standard",
    chatWidth: "narrow",
    notifyOnTaskFinished: true,
    notifyOnPending: true,
    notifySound: true,
  });

  const loadAppSettings = useCallback(async () => {
    try {
      if (window.qingwu?.getAppSettings) {
        const res = await window.qingwu.getAppSettings();
        if (res) setAppSettings(res);
      }
    } catch (e) {
      console.error("[NotificationsTab] 读取设置失败", e);
    }
  }, []);

  useEffect(() => {
    void loadAppSettings();
  }, [loadAppSettings]);

  const handleUpdateAppSetting = async (patch: Partial<AppSettings>) => {
    try {
      if (window.qingwu?.setAppSettings) {
        const next = await window.qingwu.setAppSettings(patch);
        setAppSettings(next);
      } else {
        setAppSettings((prev) => ({ ...prev, ...patch }));
      }
    } catch (e) {
      console.error("[NotificationsTab] 保存设置失败", e);
    }
  };

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.notifications.title")}</h2>
        <p>{t("settings.notifications.desc")}</p>
      </div>

      {/* 分类一：通知触发规则 */}
      <div className="native-settings-card">
        <div className="native-settings-section-title">
          {t("settings.notifications.rulesTitle")}
        </div>

        <SettingsRow
          label={t("settings.notifications.taskFinished.label")}
          desc={t("settings.notifications.taskFinished.desc")}
        >
          <SettingsSwitch
            checked={appSettings.notifyOnTaskFinished ?? true}
            onChange={(next) =>
              void handleUpdateAppSetting({ notifyOnTaskFinished: next })
            }
            label={t("settings.notifications.taskFinished.label")}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.notifications.pending.label")}
          desc={t("settings.notifications.pending.desc")}
        >
          <SettingsSwitch
            checked={appSettings.notifyOnPending ?? true}
            onChange={(next) =>
              void handleUpdateAppSetting({ notifyOnPending: next })
            }
            label={t("settings.notifications.pending.label")}
          />
        </SettingsRow>
      </div>

      {/* 分类二：提示音 */}
      <div className="native-settings-card">
        <div className="native-settings-section-title">
          {t("settings.notifications.soundTitle")}
        </div>

        <SettingsRow
          label={t("settings.notifications.sound.label")}
          desc={t("settings.notifications.sound.desc")}
        >
          <SettingsSwitch
            checked={appSettings.notifySound ?? true}
            onChange={(next) =>
              void handleUpdateAppSetting({ notifySound: next })
            }
            label={t("settings.notifications.sound.label")}
          />
        </SettingsRow>
      </div>

      {/* 分类三：免打扰说明卡片 */}
      <div className="native-settings-card native-settings-card-subtle">
        <div className="native-settings-section-title">
          {t("settings.notifications.hintTitle")}
        </div>
        <p className="native-settings-card-desc" style={{ marginTop: "6px", lineHeight: "1.6" }}>
          {t("settings.notifications.hint")}
        </p>
      </div>
    </>
  );
}
