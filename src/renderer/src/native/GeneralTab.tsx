import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings, TranscriptViewMode } from "../../../shared/types";
import type { UiLanguage } from "../../../shared/i18n-core";
import { useT } from "../i18n";
import type { ModelCatalog } from "./protocol";
import { SettingsRow, SettingsSwitch } from "./settings-ui";
import type { DshSettingsController } from "./useDshSettings";

/** 常规分区：新会话默认规则（模型与权限）+ 青梧应用级常规行为。 */
export function GeneralTab({
  dsh,
  modelCatalog,
}: {
  dsh: DshSettingsController;
  modelCatalog?: ModelCatalog | null;
}) {
  const t = useT();
  const [appSettings, setAppSettings] = useState<AppSettings>({
    closeToTray: true,
    collapseProcess: false,
    transcriptView: "standard",
    chatWidth: "narrow",
  });

  // 平铺可用模型选项（用于新会话默认模型选择）
  const modelOptions = useMemo(() => {
    if (!modelCatalog?.groups) return [];
    return modelCatalog.groups.flatMap((g) =>
      g.models.map((m) => ({
        id: `${g.id}/${m.id}`,
        label: `${g.name} - ${m.name}`,
      })),
    );
  }, [modelCatalog]);

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

  // 打开青梧专属配置目录
  const handleOpenProfileDir = async () => {
    if (window.qingwu?.openProfileFolder) {
      await window.qingwu.openProfileFolder();
    } else if (window.qingwu?.openUserDataFolder) {
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

      {dsh.settingsMessage && (
        <div className="native-settings-alert">{dsh.settingsMessage}</div>
      )}

      {/* 分类一：新会话默认规则（置顶核心偏好，对齐 Codex 规范） */}
      <div className="native-settings-card">
        <div className="native-settings-section-title">
          {t("settings.general.defaultRulesTitle")}
        </div>

        {modelOptions.length > 0 && (
          <SettingsRow
            label={t("settings.general.defaultModel.label")}
            desc={t("settings.general.defaultModel.desc")}
          >
            <select
              className="native-settings-select"
              value={dsh.defaultModelKey}
              onChange={(e) => void dsh.saveDefaultModel(e.target.value)}
            >
              <option value="">
                {t("settings.general.defaultModel.followEngine")}
              </option>
              {modelOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingsRow>
        )}

        <SettingsRow
          label={t("settings.general.defaultPreset.label")}
          desc={t("settings.general.defaultPreset.desc")}
        >
          <select
            className="native-settings-select"
            value={dsh.defaultPreset}
            onChange={(e) => void dsh.saveDefaultPreset(e.target.value)}
          >
            <option value="workspace-write">
              {t("settings.general.defaultPreset.workspaceWrite")}
            </option>
            <option value="read-only">
              {t("settings.general.defaultPreset.readOnly")}
            </option>
            <option value="danger-full-access">
              {t("settings.general.defaultPreset.fullAccess")}
            </option>
          </select>
        </SettingsRow>
      </div>

      {/* 分类二：常规行为 */}
      <div className="native-settings-card">
        <div className="native-settings-section-title">
          {t("settings.general.behaviorTitle")}
        </div>

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
          label={t("settings.general.transcriptView.label")}
          desc={t("settings.general.transcriptView.desc")}
        >
          <select
            className="native-settings-select"
            value={appSettings.transcriptView ?? "standard"}
            onChange={(e) =>
              void handleUpdateAppSetting({
                transcriptView: e.target.value as TranscriptViewMode,
              })
            }
          >
            <option value="standard">
              {t("settings.general.transcriptView.standard")}
            </option>
            <option value="detailed">
              {t("settings.general.transcriptView.detailed")}
            </option>
            <option value="compact">
              {t("settings.general.transcriptView.compact")}
            </option>
            <option value="verbose">
              {t("settings.general.transcriptView.verbose")}
            </option>
          </select>
        </SettingsRow>

        <SettingsRow
          label={t("settings.general.profileDir.label")}
          desc={t("settings.general.profileDir.desc")}
        >
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={handleOpenProfileDir}
          >
            {t("settings.general.profileDir.openFolder")}
          </button>
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={() => void dsh.openDshConfig()}
          >
            {t("settings.general.profileDir.openFile")}
          </button>
        </SettingsRow>
      </div>
    </>
  );
}
