import { useState } from "react";
import { useT } from "../i18n";
import { KeyVisibilityToggle, SettingsRow } from "./settings-ui";
import { SEARCH_MODES, type SearchKeySource, type SearchMode } from "./web-search-settings";
import type { WebSearchSettingsController } from "./useWebSearchSettings";

export function WebSearchTab({ controller: c }: { controller: WebSearchSettingsController }) {
  const t = useT();
  const [showKey, setShowKey] = useState(false);
  const busy = !c.loaded || c.saving;
  const disabled = busy || !c.writable;
  const config = c.mode === "external" ? undefined : SEARCH_MODES[c.mode];
  const keyDesc = !c.keyStatusKnown ? "statusErrorDesc"
    : c.hasKey ? "configuredDesc" : "unconfiguredDesc";
  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.webSearch.title")}</h2>
        <p><span title={t("settings.shared.engineBadgeTitle")}>{t("settings.shared.engineBadge")}</span>{t("settings.webSearch.desc")}</p>
      </div>
      {c.message && <div className="native-settings-alert">{c.message}</div>}
      {c.error && <div className="native-settings-alert" style={{ color: "var(--dsw-danger, #ef4444)" }}>{c.error}</div>}
      <div className="native-settings-card">
        <SettingsRow label={t("settings.webSearch.provider.label")} desc={t("settings.webSearch.provider.desc")}>
          <select className="native-settings-select" value={c.mode} disabled={disabled}
            onChange={(e) => c.changeMode(e.target.value as SearchMode)}>
            {c.availableModes.map((mode) => <option key={mode} value={mode}>{t("settings.webSearch.provider." + mode)}</option>)}
            {c.hasExternalConfiguration && <option value="external">{t("settings.webSearch.provider.external")} ({c.externalProvider})</option>}
          </select>
        </SettingsRow>
        {config ? <>
          <SettingsRow label={t("settings.webSearch.keySource.label")} desc={t("settings.webSearch.keySource.desc")}>
            <select className="native-settings-select" value={c.keySource} disabled={disabled}
              onChange={(e) => c.edit("keySource", e.target.value as SearchKeySource)}>
              <option value="model">{t("settings.webSearch.keySource.model")}</option>
              <option value="independent">{t("settings.webSearch.keySource.independent")}</option>
            </select>
          </SettingsRow>
          <SettingsRow label={t("settings.webSearch.apiKey.label")} desc={t("settings.webSearch.apiKey." + keyDesc)}>
            {c.keySource === "independent" ? <div className="native-key-input-wrapper">
              <input type={showKey ? "text" : "password"} className="native-settings-input"
                disabled={busy || !c.keyWritable || !c.keyStatusKnown} autoComplete="off" spellCheck={false}
                placeholder={t("settings.webSearch.apiKey." + (c.hasKey ? "placeholderConfigured" : "placeholderUnconfigured"))}
                value={c.apiKeyDraft} onChange={(e) => c.edit("apiKeyDraft", e.target.value)} />
              <KeyVisibilityToggle visible={showKey} onToggle={() => setShowKey(!showKey)} />
            </div> : <span>{t("settings.webSearch.keySource.model")}</span>}
          </SettingsRow>
          <SettingsRow label={t("settings.webSearch.baseURL.label")} desc={t("settings.webSearch.baseURL.desc")}>
            <input type="text" className="native-settings-input" disabled={disabled}
              placeholder={config.baseURL} value={c.baseURL} onChange={(e) => c.edit("baseURL", e.target.value)} />
          </SettingsRow>
          <SettingsRow label={t("settings.webSearch.limit." + (c.mode === "api" ? "countLabel" : "usesLabel"))}
            desc={t("settings.webSearch.limit." + (c.mode === "api" ? "countDesc" : "usesDesc"))}>
            <input type="number" className="native-settings-input" disabled={disabled} style={{ width: "90px" }}
              min={1} max={c.mode === "api" ? 50 : undefined} placeholder={String(config.defaultLimit)}
              value={c.limit} onChange={(e) => c.edit("limit", e.target.value)} />
          </SettingsRow>
        </> : c.loaded && <div className="native-settings-alert">{t("settings.webSearch.externalDesc")}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
        <button type="button" className="native-btn native-btn-primary"
          disabled={busy || !c.formAvailable || !(c.writable || (c.keySource === "independent" && c.keyWritable))}
          onClick={() => void c.save()}>
          {t("settings.webSearch." + (c.saving ? "saving" : "save"))}
        </button>
      </div>
    </>
  );
}
