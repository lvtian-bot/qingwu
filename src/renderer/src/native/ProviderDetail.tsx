import { useMemo } from "react";
import { useT } from "../i18n";
import {
  type ModelCatalogModel,
  type SettingsNamespaceView,
} from "./protocol";
import {
  deriveKeyRef,
  familyOf,
  schemaUnionChoices,
  stringAt,
  valueAtPath,
  type CustomModelEntry,
  type ProviderRow,
} from "./settings-domain";
import { KeyVisibilityToggle, ModelItemRow } from "./settings-ui";

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
  onDelete?: () => void;
}) {
  const t = useT();
  const row = props.row;
  const ref = row.apiKeyEnv ?? deriveKeyRef(row.provider);
  const configured = row.credentialConfigured === true;
  /** 账号登录通道：登录状态与凭据由引擎统一管理，详情区不做密钥配置。 */
  const isAccount = row.provider === "deepseek-account";
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
      : (stringAt(fallback, "baseURL") ?? t("settings.provider.apiUrlDefault"));

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

  const handleRemoveModelInDetail = (id: string) => {
    props.onDraftField(
      "models",
      declaredModels.filter((m) => m.id !== id),
    );
  };

  return (
    <div className="native-provider-detail">
      <div className="native-provider-head">
        <span className="native-provider-title">{row.displayName}</span>
        <span className="native-provider-ref-code">{row.provider}</span>
      </div>
      {row.error && <div className="native-provider-error">{row.error}</div>}
      {props.adding && (
        <div className="native-provider-card-desc">
          {t("settings.provider.notAddedHint")}
        </div>
      )}

      {isAccount ? (
        /* 账号通道：只呈现登录状态，不提供密钥与操作入口（与桌面版一致）。 */
        <div className="native-provider-field">
          <div className="native-provider-account-status">
            <span className="native-provider-account-dot" aria-hidden="true" />
            <span>{t("settings.models.accountSignedIn")}</span>
          </div>
          <div className="native-provider-card-desc">
            {t("settings.models.accountDesc")}
          </div>
        </div>
      ) : (
        <div className="native-provider-field">
          <div className="native-provider-field-label">
            <span>{t("settings.shared.apiKey")}</span>
          </div>
          <div className="native-provider-input-wrap">
            <input
              type={props.visible ? "text" : "password"}
              className="native-settings-input"
              placeholder={
                configured
                  ? t("settings.provider.apiKeySavedPlaceholder")
                  : t("settings.provider.apiKeyPlaceholder")
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
            {t("settings.provider.apiKeyDesc")}
          </div>
        </div>
      )}
      {/* 连接参数只属于用户自声明路由：内置服务商地址由适配器固定，不向用户暴露。 */}
      {row.declared === true && (
        <div className="native-provider-field">
          <div className="native-provider-field-label">
            <span>{t("settings.shared.apiUrl")}</span>
          </div>
          <input
            type="text"
            className="native-settings-input native-provider-text-input"
            placeholder={baseURLPlaceholder}
            aria-label={t("settings.shared.apiUrl")}
            value={draftBaseURL}
            disabled={!props.writable || props.loading}
            onChange={(e) => props.onDraftField("baseURL", e.target.value)}
          />
          {family === "deepseek" && (
            <div className="native-provider-card-desc">
              {t("settings.provider.apiUrlDesc")}
            </div>
          )}
        </div>
      )}

      {apiChoices.length > 0 && (
        <div className="native-provider-field">
          <div className="native-provider-field-label">
            <span>{t("settings.shared.apiProtocol")}</span>
          </div>
          <select
            className="native-settings-select native-provider-field-select"
            aria-label={t("settings.shared.apiProtocol")}
            value={effectiveApi ?? ""}
            disabled={!props.writable || props.loading}
            onChange={(e) => props.onDraftField("api", e.target.value)}
          >
            {effectiveApi === undefined && (
              <option value="">{t("settings.provider.protocolUnset")}</option>
            )}
            {apiChoices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </div>
      )}

      {!isAccount && (
        <div className="native-provider-card-action">
          <button
            type="button"
            className="native-btn native-btn-primary"
            disabled={props.loading || !props.canSave}
            onClick={props.onSave}
          >
            {t("settings.provider.save")}
          </button>
          {props.onDelete && (
            <button
              type="button"
              className="native-btn native-btn-danger"
              disabled={props.loading}
              onClick={props.onDelete}
            >
              {t("settings.provider.deleteProvider")}
            </button>
          )}
        </div>
      )}

      <div className="native-provider-models">
        <div className="native-provider-models-head">
          <span className="native-provider-models-title">
            {t("settings.provider.catalog")}
          </span>
          <span className="native-provider-models-meta">
            {t("settings.shared.modelCount", {
              count: row.declared ? declaredModels.length : props.models.length,
            })}
          </span>
        </div>

        {row.declared ? (
          declaredModels.length === 0 ? (
            <div className="native-model-empty">
              {t("settings.provider.emptyDeclared")}
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
          <div className="native-model-empty">
            {t("settings.provider.emptyCatalog")}
          </div>
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
                <span className="native-model-tag">
                  {t("settings.shared.reasoning")}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
