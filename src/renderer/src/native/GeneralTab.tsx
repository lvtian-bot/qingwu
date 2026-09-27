import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../../shared/types";
import type { UiLanguage } from "../../../shared/i18n-core";
import { useT } from "../i18n";
import { SettingsRow, SettingsSwitch } from "./settings-ui";
import type { DshSettingsController } from "./useDshSettings";

/** 常规分区：青梧应用级设置（界面、窗口与配置文件入口）。 */
export function GeneralTab({ dsh }: { dsh: DshSettingsController }) {
  const t = useT();
  const [appSettings, setAppSettings] = useState<AppSettings>({
    closeToTray: true,
    collapseProcess: false,
    chatWidth: "narrow",
  });

  // 读取本地应用设置
  const loadAppSettings = useCallback(async () => {
    try {
      if (window.qingwu?.getAppSettings) {
        const res = await window.qingwu.getAppSettings();
        if (res) setAppSettings(res);
      }
    } catch (e) {
      console.error("[SettingsPage] 读取应用设置失败", e);
    }
  }, []);

  useEffect(() => {
    void loadAppSettings();
  }, [loadAppSettings]);

  // 更新本地应用设置
  const handleUpdateAppSetting = async (patch: Partial<AppSettings>) => {
    try {
      if (window.qingwu?.setAppSettings) {
        const next = await window.qingwu.setAppSettings(patch);
        setAppSettings(next);
      } else {
        setAppSettings((prev) => ({ ...prev, ...patch }));
      }
    } catch (e) {
      console.error("[SettingsPage] 保存应用设置失败", e);
    }
  };

  // 打开青梧本地数据目录
  const handleOpenAppData = async () => {
    if (window.qingwu?.openUserDataFolder) {
      await window.qingwu.openUserDataFolder();
    }
  };

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.general.title")}</h2>
        <p>
          <span title={t("settings.general.uiBadgeTitle")}>
            {t("settings.general.uiBadge")}
          </span>
          {t("settings.general.desc")}
        </p>
      </div>

      <div className="native-settings-card">
        <SettingsRow
          label={t("settings.general.language.label")}
          desc={t("settings.general.language.desc")}
        >
          <select
            className="native-settings-select"
            value={appSettings.uiLanguage ?? "auto"}
            onChange={(e) =>
              void handleUpdateAppSetting({
                uiLanguage: e.target.value as UiLanguage,
              })
            }
          >
            <option value="auto">{t("settings.general.language.auto")}</option>
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </SettingsRow>

        <SettingsRow
          label={t("settings.general.chatWidth.label")}
          desc={t("settings.general.chatWidth.desc")}
        >
          <select
            className="native-settings-select"
            value={appSettings.chatWidth ?? "narrow"}
            onChange={(e) =>
              void handleUpdateAppSetting({
                chatWidth: e.target.value as AppSettings["chatWidth"],
              })
            }
          >
            <option value="narrow">{t("settings.general.chatWidth.narrow")}</option>
            <option value="medium">{t("settings.general.chatWidth.medium")}</option>
            <option value="wide">{t("settings.general.chatWidth.wide")}</option>
          </select>
        </SettingsRow>

        <SettingsRow
          label={t("settings.general.closeToTray.label")}
          desc={t("settings.general.closeToTray.desc")}
        >
          <SettingsSwitch
            checked={appSettings.closeToTray}
            onChange={(next) =>
              void handleUpdateAppSetting({ closeToTray: next })
            }
            label={t("settings.general.closeToTray.label")}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.general.collapseProcess.label")}
          desc={t("settings.general.collapseProcess.desc")}
        >
          <SettingsSwitch
            checked={Boolean(appSettings.collapseProcess)}
            onChange={(next) =>
              void handleUpdateAppSetting({ collapseProcess: next })
            }
            label={t("settings.general.collapseProcess.label")}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.general.notifyOnTaskFinished.label")}
          desc={t("settings.general.notifyOnTaskFinished.desc")}
        >
          <SettingsSwitch
            checked={appSettings.notifyOnTaskFinished ?? true}
            onChange={(next) =>
              void handleUpdateAppSetting({ notifyOnTaskFinished: next })
            }
            label={t("settings.general.notifyOnTaskFinished.label")}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.general.appData.label")}
          desc={t("settings.general.appData.desc")}
        >
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={handleOpenAppData}
          >
            {t("settings.general.appData.open")}
          </button>
        </SettingsRow>

        <SettingsRow
          label={t("settings.general.dshConfig.label")}
          desc={t("settings.general.dshConfig.desc")}
        >
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={() => void dsh.openDshConfig()}
          >
            {t("settings.general.dshConfig.open")}
          </button>
        </SettingsRow>
      </div>
    </>
  );
}
