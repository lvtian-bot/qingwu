import { useState } from "react";
import { useT } from "../i18n";
import { KeyVisibilityToggle, SettingsRow } from "./settings-ui";
import {
  DEFAULT_SEARCH_API_BASE_URL,
  type WebSearchSettingsController,
} from "./useWebSearchSettings";

export function WebSearchTab({ controller }: { controller: WebSearchSettingsController }) {
  const t = useT();
  const [showKey, setShowKey] = useState(false);

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.webSearch.title")}</h2>
        <p>
          <span title={t("settings.shared.engineBadgeTitle")}>
            {t("settings.shared.engineBadge")}
          </span>
          {t("settings.webSearch.desc")}
        </p>
      </div>

      {controller.message && (
        <div className="native-settings-alert" style={{ borderColor: "var(--dsw-accent, #3b82f6)" }}>
          {controller.message}
        </div>
      )}

      {controller.error && (
        <div className="native-settings-alert" style={{ color: "var(--dsw-danger, #ef4444)" }}>
          {controller.error}
        </div>
      )}

      <div className="native-settings-card">
        {/* 服务提供方 */}
        <SettingsRow
          label={t("settings.webSearch.provider.label")}
          desc={t("settings.webSearch.provider.desc")}
        >
          <select
            className="native-settings-select"
            value={controller.providerType}
            onChange={(e) =>
              controller.setProviderType(e.target.value as "deepseek" | "custom")
            }
          >
            <option value="deepseek">
              {t("settings.webSearch.provider.deepseek")}
            </option>
            <option value="custom">
              {t("settings.webSearch.provider.custom")}
            </option>
          </select>
        </SettingsRow>

        {/* 凭据状态与单独配置 */}
        <SettingsRow
          label={t("settings.webSearch.apiKey.label")}
          desc={
            controller.hasKey
              ? t("settings.webSearch.apiKey.configuredDesc")
              : t("settings.webSearch.apiKey.unconfiguredDesc")
          }
        >
          <div className="native-key-input-wrapper">
            <input
              type={showKey ? "text" : "password"}
              className="native-settings-input"
              placeholder={
                controller.hasKey
                  ? t("settings.webSearch.apiKey.placeholderConfigured")
                  : t("settings.webSearch.apiKey.placeholderUnconfigured")
              }
              value={controller.apiKeyDraft}
              onChange={(e) => controller.setApiKeyDraft(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <KeyVisibilityToggle
              visible={showKey}
              onToggle={() => setShowKey(!showKey)}
            />
          </div>
        </SettingsRow>

        {/* 基础接口地址 */}
        <SettingsRow
          label={t("settings.webSearch.baseURL.label")}
          desc={
            controller.providerType === "deepseek"
              ? t("settings.webSearch.baseURL.deepseekDesc")
              : t("settings.webSearch.baseURL.customDesc")
          }
        >
          {controller.providerType === "deepseek" ? (
            <input
              type="text"
              className="native-settings-input"
              value={DEFAULT_SEARCH_API_BASE_URL}
              disabled
              readOnly
            />
          ) : (
            <input
              type="text"
              className="native-settings-input"
              placeholder={DEFAULT_SEARCH_API_BASE_URL}
              value={controller.baseURL}
              onChange={(e) => controller.setBaseURL(e.target.value)}
            />
          )}
        </SettingsRow>

        {/* 每次搜索条数 */}
        <SettingsRow
          label={t("settings.webSearch.count.label")}
          desc={t("settings.webSearch.count.desc")}
        >
          <input
            type="number"
            className="native-settings-input"
            style={{ width: "90px" }}
            min={1}
            max={50}
            value={controller.count}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                controller.setCount(val);
              }
            }}
          />
        </SettingsRow>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
        <button
          type="button"
          className="native-btn native-btn-primary"
          disabled={!controller.loaded || controller.saving}
          onClick={() => void controller.save()}
        >
          {controller.saving
            ? t("settings.webSearch.saving")
            : t("settings.webSearch.save")}
        </button>
      </div>
    </>
  );
}
