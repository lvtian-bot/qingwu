import { useCallback, useEffect, useState } from "react";
import type { AppSettings, ChatWidth, ThemeMode } from "../../../shared/types";
import { useT } from "../i18n";
import { SettingsRow } from "./settings-ui";

/** 外观分区：色彩主题与聊天区排版宽度。 */
export function AppearanceTab() {
  const t = useT();
  const [appSettings, setAppSettings] = useState<AppSettings>({
    closeToTray: true,
    collapseProcess: false,
    transcriptView: "standard",
    chatWidth: "narrow",
    theme: "auto",
  });

  const loadAppSettings = useCallback(async () => {
    try {
      if (window.qingwu?.getAppSettings) {
        const res = await window.qingwu.getAppSettings();
        if (res) setAppSettings(res);
      }
    } catch (e) {
      console.error("[AppearanceTab] 读取设置失败", e);
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
      // 若包含主题变更，联动更新 documentElement 属性以即时生效
      if (patch.theme) {
        if (patch.theme === "auto") {
          delete document.documentElement.dataset.theme;
        } else {
          document.documentElement.dataset.theme = patch.theme;
        }
      }
    } catch (e) {
      console.error("[AppearanceTab] 保存设置失败", e);
    }
  };

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.appearance.title")}</h2>
        <p>{t("settings.appearance.desc")}</p>
      </div>

      {/* 分类一：色彩主题 */}
      <div className="native-settings-section">
        <div className="native-settings-section-title">
          {t("settings.appearance.themeTitle")}
        </div>
        <div className="native-settings-card">
          <SettingsRow
            label={t("settings.appearance.theme.label")}
            desc={t("settings.appearance.theme.desc")}
          >
            <select
              className="native-settings-select"
              value={appSettings.theme ?? "auto"}
              onChange={(e) =>
                void handleUpdateAppSetting({
                  theme: e.target.value as ThemeMode,
                })
              }
            >
              <option value="auto">{t("settings.appearance.theme.auto")}</option>
              <option value="light">{t("settings.appearance.theme.light")}</option>
              <option value="dark">{t("settings.appearance.theme.dark")}</option>
            </select>
          </SettingsRow>
        </div>
      </div>

      {/* 分类二：排版与布局 */}
      <div className="native-settings-section">
        <div className="native-settings-section-title">
          {t("settings.appearance.layoutTitle")}
        </div>
        <div className="native-settings-card">
          <SettingsRow
            label={t("settings.appearance.chatWidth.label")}
            desc={t("settings.appearance.chatWidth.desc")}
          >
            <select
              className="native-settings-select"
              value={appSettings.chatWidth ?? "narrow"}
              onChange={(e) =>
                void handleUpdateAppSetting({
                  chatWidth: e.target.value as ChatWidth,
                })
              }
            >
              <option value="narrow">{t("settings.appearance.chatWidth.narrow")}</option>
              <option value="medium">{t("settings.appearance.chatWidth.medium")}</option>
              <option value="wide">{t("settings.appearance.chatWidth.wide")}</option>
            </select>
          </SettingsRow>
        </div>
      </div>
    </>
  );
}
