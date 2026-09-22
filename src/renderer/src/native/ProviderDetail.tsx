import { useMemo, useState } from "react";
import { CandidateModelPicker } from "./CandidateModelPicker";
import {
  type LlmDiscoveredModel,
  type ModelCatalogModel,
  type SettingsNamespaceView,
} from "./protocol";
import {
  appendManualModel,
  deriveKeyRef,
  familyOf,
  mergeCandidateModels,
  schemaUnionChoices,
  stringAt,
  valueAtPath,
  type CustomModelEntry,
  type ProviderRow,
} from "./settings-domain";
import { KeyVisibilityToggle, ModelAddRow, ModelItemRow } from "./settings-ui";
import { useModelDiscovery } from "./useModelDiscovery";

/** 供应商详情区：密钥 + 连接参数（API 地址/协议）+ 模型目录。 */
export function ProviderDetail(props: {
  row: ProviderRow;
  /** 添加流程中：供应商尚未加入左侧列表，保存后加入。 */
  adding?: boolean;
  models: ModelCatalogModel[];
  /** 所属设置命名空间视图（承载 profile 的解析值、用户段与修订号）。 */
  view?: SettingsNamespaceView;
  writable: boolean;
  /** 用户段草稿（完整子树副本；受管字段经 onDraftField 修改）。 */
  draft: Record<string, unknown>;
  onDraftField: (key: string, value: unknown) => void;
  inputValue: string;
  visible: boolean;
  loading: boolean;
  /** 草稿相对用户段基线有变化或已输入密钥时才可保存。 */
  canSave: boolean;
  onInputChange: (ref: string, value: string) => void;
  onToggleVisible: (ref: string) => void;
  onSave: () => void;
  onUnset: (ref: string) => void;
  onDelete?: () => void;
}) {
  const row = props.row;
  const ref = row.apiKeyEnv ?? deriveKeyRef(row.provider);
  const configured = row.credentialConfigured === true;
  const family = familyOf(row.settingsNs);
  const fallback = valueAtPath(props.view?.value, row.settingsPath);
  const draftBaseURL = stringAt(props.draft, "baseURL") ?? "";
  const effectiveApi =
    stringAt(props.draft, "api") ?? stringAt(fallback, "api");
  // 自声明 pi-ai 路由可改协议；选项取自命名空间 schema，与适配器接受值同源。
  const apiChoices =
    family === "pi-ai" && row.declared === true && props.view
      ? schemaUnionChoices(props.view.schema, [
          "providers",
          "\u0000probe",
          "api",
        ])
      : [];
  const baseURLPlaceholder =
    family === "deepseek"
      ? stringAt(fallback, "protocol") === "messages"
        ? "https://api.deepseek.com/anthropic"
        : "https://api.deepseek.com"
      : (stringAt(fallback, "baseURL") ?? "提供方默认");

  const declaredModels: CustomModelEntry[] = useMemo(() => {
    if (Array.isArray(props.draft.models)) {
      return props.draft.models as CustomModelEntry[];
    }
    const fbModels = (fallback as { models?: unknown })?.models;
    if (Array.isArray(fbModels)) {
      return fbModels as CustomModelEntry[];
    }
    return props.models.map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: Boolean(m.reasoning),
    }));
  }, [props.draft.models, fallback, props.models]);

  const [manualModelId, setManualModelId] = useState("");
  const [manualModelName, setManualModelName] = useState("");
  const [manualModelReasoning, setManualModelReasoning] = useState(false);
  const discovery = useModelDiscovery();

  const effectiveBaseURL =
    draftBaseURL || (stringAt(fallback, "baseURL") ?? "");

  const handleDiscoverInDetail = () =>
    void discovery.discover({
      settingsNs: row.settingsNs || "llm-pi-ai",
      request: {
        baseURL: effectiveBaseURL,
        api: effectiveApi,
        ...(props.inputValue.trim() ? { apiKey: props.inputValue.trim() } : {}),
      },
      invalidUrlMessage: "请先配置有效的 API 地址 (HTTP/HTTPS URL)",
    });

  const handleAddCandidatesInDetail = (chosen: LlmDiscoveredModel[]) => {
    props.onDraftField("models", mergeCandidateModels(declaredModels, chosen));
    discovery.closeCandidates();
  };

  const handleAddManualInDetail = () => {
    const id = manualModelId.trim();
    if (!id) return;
    const result = appendManualModel(
      declaredModels,
      id,
      manualModelName.trim(),
      manualModelReasoning,
    );
    if (!result.ok) {
      discovery.setFetchError(result.error);
      return;
    }
    props.onDraftField("models", result.models);
    setManualModelId("");
    setManualModelName("");
    setManualModelReasoning(false);
    discovery.setFetchError(null);
  };

  const handleRemoveModelInDetail = (id: string) => {
    props.onDraftField(
      "models",
      declaredModels.filter((m) => m.id !== id),
    );
  };

  return (
    <div className="native-provider-detail">
      {discovery.candidates && (
        <CandidateModelPicker
          candidates={discovery.candidates}
          onAdd={handleAddCandidatesInDetail}
          onClose={discovery.closeCandidates}
        />
      )}
      <div className="native-provider-head">
        <span className="native-provider-title">{row.displayName}</span>
        <span className="native-provider-ref-code">{row.provider}</span>
      </div>
      {row.error && <div className="native-provider-error">{row.error}</div>}
      {props.adding && (
        <div className="native-provider-card-desc">
          该服务商还未添加，保存后会加入左侧列表。
        </div>
      )}

      <div className="native-provider-field">
        <div className="native-provider-field-label">
          <span>API 密钥</span>
        </div>
        <div className="native-provider-input-wrap">
          <input
            type={props.visible ? "text" : "password"}
            className="native-settings-input"
            placeholder={
              configured
                ? "●●●●●●●●（已保存密钥，输入新值可覆盖）"
                : "输入 API Key 凭据"
            }
            value={props.inputValue}
            onChange={(e) => props.onInputChange(ref, e.target.value)}
          />
          <KeyVisibilityToggle
            visible={props.visible}
            onToggle={() => props.onToggleVisible(ref)}
          />
        </div>
        <div className="native-provider-card-desc">
          密钥安全保存在引擎凭据安全区，严格脱敏不回显。
        </div>
      </div>

      {family !== "unknown" && (
        <div className="native-provider-field">
          <div className="native-provider-field-label">
            <span>API 地址</span>
          </div>
          <input
            type="text"
            className="native-settings-input native-provider-text-input"
            placeholder={baseURLPlaceholder}
            aria-label="API 地址"
            value={draftBaseURL}
            disabled={!props.writable || props.loading}
            onChange={(e) => props.onDraftField("baseURL", e.target.value)}
          />
          {family === "deepseek" && (
            <div className="native-provider-card-desc">
              请填写与当前连接配置兼容的 API 地址；留空使用官方默认地址。
            </div>
          )}
        </div>
      )}

      {apiChoices.length > 0 && (
        <div className="native-provider-field">
          <div className="native-provider-field-label">
            <span>API 协议</span>
          </div>
          <select
            className="native-settings-select native-provider-field-select"
            aria-label="API 协议"
            value={effectiveApi ?? ""}
            disabled={!props.writable || props.loading}
            onChange={(e) => props.onDraftField("api", e.target.value)}
          >
            {effectiveApi === undefined && (
              <option value="">未选择（默认）</option>
            )}
            {apiChoices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="native-provider-card-action">
        <button
          type="button"
          className="native-btn native-btn-primary"
          disabled={props.loading || !props.canSave}
          onClick={props.onSave}
        >
          保存
        </button>
        {configured && (
          <button
            type="button"
            className="native-btn native-btn-secondary"
            disabled={props.loading}
            onClick={() => props.onUnset(ref)}
          >
            清除密钥
          </button>
        )}
        {props.onDelete && (
          <button
            type="button"
            className="native-btn native-btn-danger"
            disabled={props.loading}
            onClick={props.onDelete}
          >
            删除此服务商
          </button>
        )}
      </div>

      <div className="native-provider-models">
        <div className="native-provider-models-head">
          <span className="native-provider-models-title">模型目录</span>
          <span className="native-provider-models-meta">
            {row.declared ? declaredModels.length : props.models.length} 个
          </span>
          {row.declared && (
            <div className="native-model-actions-head">
              <button
                type="button"
                className="native-btn native-btn-secondary native-btn-sm"
                disabled={
                  discovery.fetching || props.loading || !effectiveBaseURL
                }
                onClick={handleDiscoverInDetail}
                title={
                  effectiveBaseURL
                    ? "从服务商接口拉取可用模型"
                    : "请先填写并保存 API 地址"
                }
              >
                {discovery.fetching ? "获取中..." : "获取可用模型"}
              </button>
            </div>
          )}
        </div>

        {discovery.fetchError && (
          <div className="native-provider-error">{discovery.fetchError}</div>
        )}

        {row.declared ? (
          declaredModels.length === 0 ? (
            <div className="native-model-empty">
              未配置模型。请点击「获取可用模型」或在下方手动添加。
            </div>
          ) : (
            declaredModels.map((model) => (
              <ModelItemRow
                key={model.id}
                model={model}
                onRemove={handleRemoveModelInDetail}
              />
            ))
          )
        ) : props.models.length === 0 ? (
          <div className="native-model-empty">未获取到该供应商的模型清单</div>
        ) : (
          props.models.map((model) => (
            <div key={model.id} className="native-model-item">
              <div className="native-settings-row-text">
                <div className="native-model-name">
                  {model.name}
                  {model.id !== model.name && (
                    <span className="native-model-id">{model.id}</span>
                  )}
                </div>
                {model.description && (
                  <div className="native-settings-row-desc">
                    {model.description}
                  </div>
                )}
              </div>
              {model.reasoning && (
                <span className="native-model-tag">推理</span>
              )}
            </div>
          ))
        )}

        {row.declared && (
          <ModelAddRow
            idValue={manualModelId}
            nameValue={manualModelName}
            reasoning={manualModelReasoning}
            onIdChange={setManualModelId}
            onNameChange={setManualModelName}
            onReasoningChange={setManualModelReasoning}
            onAdd={handleAddManualInDetail}
          />
        )}
      </div>
    </div>
  );
}
