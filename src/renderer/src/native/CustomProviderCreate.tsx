import { useState } from "react";
import { useT } from "../i18n";
import { CandidateModelPicker } from "./CandidateModelPicker";
import type { CustomModelEntry } from "./settings-domain";
import {
  ROUTE_PATTERN,
  appendManualModel,
  isHttpUrl,
  mergeCandidateModels,
} from "./settings-domain";
import { KeyVisibilityToggle, ModelAddRow, ModelItemRow } from "./settings-ui";
import { useModelDiscovery } from "./useModelDiscovery";

/** 添加自定义服务商表单面板。 */
export function CustomProviderCreate(props: {
  existingRoutes: string[];
  protocols: string[];
  writable: boolean;
  loading: boolean;
  onSave: (data: {
    route: string;
    displayName?: string;
    api: string;
    baseURL: string;
    apiKey?: string;
    models: CustomModelEntry[];
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const [route, setRoute] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [api, setApi] = useState(props.protocols[0] ?? "openai-completions");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [models, setModels] = useState<CustomModelEntry[]>([]);
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelReasoning, setNewModelReasoning] = useState(false);
  const discovery = useModelDiscovery();

  const cleanRoute = route.trim().toLowerCase();
  const routeInvalid = cleanRoute.length > 0 && !ROUTE_PATTERN.test(cleanRoute);
  const routeTaken = props.existingRoutes.includes(cleanRoute);
  const cleanBaseURL = baseURL.trim();
  const baseUrlInvalid = cleanBaseURL.length > 0 && !isHttpUrl(cleanBaseURL);
  const canSave =
    cleanRoute.length > 0 &&
    !routeInvalid &&
    !routeTaken &&
    cleanBaseURL.length > 0 &&
    !baseUrlInvalid &&
    models.length > 0 &&
    !props.loading &&
    props.writable;

  const handleFetchModels = () =>
    void discovery.discover({
      settingsNs: "llm-pi-ai",
      request: {
        baseURL: cleanBaseURL,
        api: api || undefined,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      invalidUrlMessage: t("settings.custom.invalidApiUrl"),
    });

  const handleAddCandidates = (
    chosen: Parameters<typeof mergeCandidateModels>[1],
  ) => {
    setModels((prev) => mergeCandidateModels(prev, chosen));
    discovery.closeCandidates();
  };

  const handleAddManualModel = () => {
    const id = newModelId.trim();
    if (!id) return;
    const result = appendManualModel(
      models,
      id,
      newModelName.trim(),
      newModelReasoning,
      t,
    );
    if (!result.ok) {
      discovery.setFetchError(result.error);
      return;
    }
    setModels(result.models);
    setNewModelId("");
    setNewModelName("");
    setNewModelReasoning(false);
    discovery.setFetchError(null);
  };

  const handleRemoveModel = (id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div className="native-provider-detail">
      {discovery.candidates && (
        <CandidateModelPicker
          candidates={discovery.candidates}
          onAdd={handleAddCandidates}
          onClose={discovery.closeCandidates}
        />
      )}
      <div className="native-provider-head">
        <span className="native-provider-title">
          {t("settings.custom.title")}
        </span>
        <button
          type="button"
          className="native-btn native-btn-secondary native-btn-sm"
          onClick={props.onCancel}
        >
          {t("settings.custom.backToList")}
        </button>
      </div>

      <div className="native-provider-card-desc">
        {t("settings.custom.desc")}
      </div>

      {discovery.fetchError && (
        <div className="native-provider-error">{discovery.fetchError}</div>
      )}

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>{t("settings.custom.route.label")}</span>
        </div>
        <input
          type="text"
          className={`native-settings-input native-provider-text-input ${
            routeInvalid || routeTaken ? "input-error" : ""
          }`}
          placeholder={t("settings.custom.route.placeholder")}
          value={route}
          onChange={(e) => setRoute(e.target.value.toLowerCase())}
        />
        <div className="native-provider-card-desc">
          {routeInvalid
            ? t("settings.custom.route.invalid")
            : routeTaken
              ? t("settings.custom.route.taken")
              : t("settings.custom.route.desc")}
        </div>
      </div>

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>{t("settings.custom.displayName.label")}</span>
        </div>
        <input
          type="text"
          className="native-settings-input native-provider-text-input"
          placeholder={t("settings.custom.displayName.placeholder")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>{t("settings.shared.apiProtocol")}</span>
        </div>
        <select
          className="native-settings-select native-provider-field-select"
          value={api}
          onChange={(e) => setApi(e.target.value)}
        >
          {props.protocols.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>{t("settings.custom.baseUrl.label")}</span>
        </div>
        <input
          type="text"
          className={`native-settings-input native-provider-text-input ${
            baseUrlInvalid ? "input-error" : ""
          }`}
          placeholder={t("settings.custom.baseUrl.placeholder")}
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
        />
        {baseUrlInvalid && (
          <div className="native-provider-error">
            {t("settings.custom.baseUrl.invalid")}
          </div>
        )}
      </div>

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>{t("settings.shared.apiKey")}</span>
        </div>
        <div className="native-provider-input-wrap">
          <input
            type={keyVisible ? "text" : "password"}
            className="native-settings-input"
            placeholder={t("settings.custom.apiKeyPlaceholder")}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <KeyVisibilityToggle
            visible={keyVisible}
            onToggle={() => setKeyVisible(!keyVisible)}
          />
        </div>
      </div>

      <div className="native-provider-models">
        <div className="native-provider-models-head">
          <span className="native-provider-models-title">
            {t("settings.custom.modelsTitle")}
          </span>
          <span className="native-provider-models-meta">
            {t("settings.shared.modelCount", { count: models.length })}
          </span>
          <div className="native-model-actions-head">
            <button
              type="button"
              className="native-btn native-btn-secondary native-btn-sm"
              disabled={discovery.fetching || !cleanBaseURL || baseUrlInvalid}
              onClick={handleFetchModels}
              title={
                cleanBaseURL
                  ? t("settings.custom.discoverTitle")
                  : t("settings.custom.discoverNeedUrlTitle")
              }
            >
              {discovery.fetching
                ? t("settings.shared.discovering")
                : t("settings.shared.discover")}
            </button>
          </div>
        </div>

        {models.length === 0 ? (
          <div className="native-model-empty">
            {t("settings.custom.empty")}
          </div>
        ) : (
          models.map((model) => (
            <ModelItemRow
              key={model.id}
              model={model}
              onRemove={handleRemoveModel}
            />
          ))
        )}

        <ModelAddRow
          idValue={newModelId}
          nameValue={newModelName}
          reasoning={newModelReasoning}
          onIdChange={setNewModelId}
          onNameChange={setNewModelName}
          onReasoningChange={setNewModelReasoning}
          onAdd={handleAddManualModel}
        />
      </div>

      <div className="native-provider-card-action">
        <button
          type="button"
          className="native-btn native-btn-primary"
          disabled={!canSave}
          onClick={() => {
            void props.onSave({
              route: cleanRoute,
              displayName: displayName.trim() || undefined,
              api,
              baseURL: cleanBaseURL,
              apiKey: apiKey.trim() || undefined,
              models,
            });
          }}
        >
          {t("settings.custom.saveAndAdd")}
        </button>
        <button
          type="button"
          className="native-btn native-btn-secondary"
          onClick={props.onCancel}
        >
          {t("settings.custom.cancel")}
        </button>
      </div>
    </div>
  );
}
