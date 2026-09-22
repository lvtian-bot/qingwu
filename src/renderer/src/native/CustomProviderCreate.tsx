import { useState } from "react";
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
      invalidUrlMessage: "请先输入有效的接口地址 (HTTP/HTTPS URL)",
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
        <span className="native-provider-title">添加自定义服务商</span>
        <button
          type="button"
          className="native-btn native-btn-secondary native-btn-sm"
          onClick={props.onCancel}
        >
          返回列表
        </button>
      </div>

      <div className="native-provider-card-desc">
        声明一条由用户自行配置的 LLM 路由，支持自建网关或 OpenAI / Anthropic
        兼容端点。
      </div>

      {discovery.fetchError && (
        <div className="native-provider-error">{discovery.fetchError}</div>
      )}

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>服务商 ID (Route)</span>
        </div>
        <input
          type="text"
          className={`native-settings-input native-provider-text-input ${
            routeInvalid || routeTaken ? "input-error" : ""
          }`}
          placeholder="例如: one-api 或 my-gateway"
          value={route}
          onChange={(e) => setRoute(e.target.value.toLowerCase())}
        />
        <div className="native-provider-card-desc">
          {routeInvalid
            ? "服务商 ID 须以小写字母开头，仅由小写英文字母、数字和连字符（-）组成"
            : routeTaken
              ? "已存在相同 ID 的服务商"
              : "用于唯一标识服务商并在配置与凭据中寻址，创建后不可修改"}
        </div>
      </div>

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>显示名称</span>
        </div>
        <input
          type="text"
          className="native-settings-input native-provider-text-input"
          placeholder="例如: 我的自建网关（可选）"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>API 协议</span>
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
          <span>接口地址 (Base URL)</span>
        </div>
        <input
          type="text"
          className={`native-settings-input native-provider-text-input ${
            baseUrlInvalid ? "input-error" : ""
          }`}
          placeholder="例如: https://api.openai-proxy.com/v1"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
        />
        {baseUrlInvalid && (
          <div className="native-provider-error">
            请输入以 http:// 或 https:// 开头的合法 URL
          </div>
        )}
      </div>

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>API 密钥</span>
        </div>
        <div className="native-provider-input-wrap">
          <input
            type={keyVisible ? "text" : "password"}
            className="native-settings-input"
            placeholder="输入 API Key（无需鉴权可留空）"
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
          <span className="native-provider-models-title">模型清单</span>
          <span className="native-provider-models-meta">
            {models.length} 个
          </span>
          <div className="native-model-actions-head">
            <button
              type="button"
              className="native-btn native-btn-secondary native-btn-sm"
              disabled={discovery.fetching || !cleanBaseURL || baseUrlInvalid}
              onClick={handleFetchModels}
              title={
                cleanBaseURL ? "从接口拉取候选模型" : "请先输入有效的接口地址"
              }
            >
              {discovery.fetching ? "获取中..." : "获取可用模型"}
            </button>
          </div>
        </div>

        {models.length === 0 ? (
          <div className="native-model-empty">
            尚未添加模型。请点击「获取可用模型」从服务商拉取，或在下方手动添加。
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
          保存并添加
        </button>
        <button
          type="button"
          className="native-btn native-btn-secondary"
          onClick={props.onCancel}
        >
          取消
        </button>
      </div>
    </div>
  );
}
