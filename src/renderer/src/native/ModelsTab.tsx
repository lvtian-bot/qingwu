import { useMemo } from "react";
import { useT } from "../i18n";
import { CustomProviderCreate } from "./CustomProviderCreate";
import { ProviderDetail } from "./ProviderDetail";
import type { ModelCatalog } from "./protocol";
import { providerDisplayName } from "./provider-brand";
import { deriveKeyRef } from "./settings-domain";
import { SettingsRow } from "./settings-ui";
import type { DshSettingsController } from "./useDshSettings";
import {
  useAvailableProtocols,
  useProviderDirectory,
} from "./useProviderDirectory";

/** 模型设置分区：供应商目录与凭据管理 + 新会话默认模型。 */
export function ModelsTab({
  modelCatalog,
  onRefreshCatalog,
  dsh,
}: {
  modelCatalog?: ModelCatalog | null;
  /** 凭据变化后刷新引擎模型目录（供应商注册与模型清单随之更新）。 */
  onRefreshCatalog?: () => void;
  dsh: DshSettingsController;
}) {
  const dir = useProviderDirectory({ onRefreshCatalog });
  const availableProtocols = useAvailableProtocols(dir.llmViews);
  const t = useT();
  const {
    providerRows,
    addedRows,
    availableRows,
    selectedProvider,
    selectProvider,
    setSelectedProvider,
    selectedRow,
    selectedIsAdded,
    selectedView,
    isSelectedRemovable,
    addingProvider,
    setAddingProvider,
    isAddingCustom,
    setIsAddingCustom,
    isAddingFlow,
    startAddingFlow,
    exitAddingFlow,
    keyInputs,
    setKeyInputs,
    keyVisible,
    setKeyVisible,
    credLoading,
    credMessage,
    settingsWritable,
    draft,
    profileDirty,
    setDraftField,
    loadProviders,
    handleUnsetCredential,
    handleSaveCustom,
    handleDeleteProvider,
    handleSaveProvider,
  } = dir;

  // 平铺可用模型选项
  const modelOptions = useMemo(() => {
    if (!modelCatalog?.groups) return [];
    return modelCatalog.groups.flatMap((g) =>
      g.models.map((m) => ({
        id: `${g.id}/${m.id}`,
        label: `${g.name} - ${m.name}`,
      })),
    );
  }, [modelCatalog]);

  return (
    <>
      <div className="native-settings-panel-header native-models-header">
        <h2>{t("settings.models.title")}</h2>
        <div className="native-models-header-row">
          <p>
            <span title={t("settings.shared.engineBadgeTitle")}>
              {t("settings.shared.engineBadge")}
            </span>
            {t("settings.models.desc")}
          </p>
          <div className="native-models-actions">
            <button
              type="button"
              className="native-provider-refresh"
              title={t("settings.models.refreshTitle")}
              onClick={() => {
                void loadProviders();
                onRefreshCatalog?.();
              }}
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
              >
                <path d="M13.65 2.35a8 8 0 1 0 2.28 6.42c.04-.34-.25-.62-.59-.62-.31 0-.56.25-.6.56a6.8 6.8 0 1 1-1.79-5.06L10.5 5.1a.5.5 0 0 0 .36.86h4.1a.5.5 0 0 0 .5-.5v-4.1a.5.5 0 0 0-.86-.36l-.95.95z" />
              </svg>
            </button>
            {/* 按钮常驻：添加流程中再点即回到服务商选择网格 */}
            <button
              type="button"
              className="native-btn native-btn-primary"
              onClick={startAddingFlow}
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
              >
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
              </svg>
              {t("settings.models.addProvider")}
            </button>
          </div>
        </div>
      </div>

      {credMessage && (
        <div className="native-settings-alert">{credMessage}</div>
      )}

      {dsh.settingsMessage && (
        <div className="native-settings-alert">{dsh.settingsMessage}</div>
      )}

      <div className="native-settings-card native-provider-layout">
        {/* 左：已添加供应商列表 */}
        <nav className="native-provider-nav">
          {addedRows.map((row) => (
            <button
              key={row.provider}
              type="button"
              className={`native-provider-nav-item ${
                selectedProvider === row.provider &&
                !addingProvider &&
                !isAddingCustom
                  ? "active"
                  : ""
              }`}
              onClick={() => selectProvider(row.provider)}
              title={row.displayName}
            >
              <span className="native-provider-nav-name">
                {row.displayName}
              </span>
              {row.declared && (
                <span className="native-provider-badge">
                  {t("settings.models.customBadge")}
                </span>
              )}
            </button>
          ))}
          {addedRows.length === 0 && (
            <div className="native-provider-nav-empty">
              {t("settings.models.noProviders")}
            </div>
          )}
        </nav>

        {/* 右：详情或「添加供应商」选择器（流程收在卡片内部，页面标题保持不动） */}
        <div className="native-provider-pane">
          {isAddingFlow && (
            <div className="native-provider-flow-head">
              <button
                type="button"
                className="native-models-back"
                onClick={exitAddingFlow}
                title={t("settings.models.exitAddFlow")}
                aria-label={t("settings.models.exitAddFlow")}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="native-provider-flow-title">
                {t("settings.models.addProvider")}
              </span>
            </div>
          )}
          {isAddingCustom ? (
            <CustomProviderCreate
              existingRoutes={providerRows.map((r) => r.provider)}
              protocols={availableProtocols}
              writable={settingsWritable}
              loading={credLoading}
              onSave={handleSaveCustom}
              onCancel={() => {
                setIsAddingCustom(false);
                setAddingProvider(true);
              }}
            />
          ) : selectedRow && (selectedIsAdded || addingProvider) ? (
            <ProviderDetail
              row={selectedRow}
              adding={addingProvider && !selectedIsAdded}
              models={
                modelCatalog?.groups?.find((g) => g.id === selectedRow.provider)
                  ?.models ?? []
              }
              view={selectedView}
              writable={settingsWritable}
              draft={draft}
              onDraftField={setDraftField}
              inputValue={
                keyInputs[
                  selectedRow.apiKeyEnv ?? deriveKeyRef(selectedRow.provider)
                ] ?? ""
              }
              visible={
                keyVisible[
                  selectedRow.apiKeyEnv ?? deriveKeyRef(selectedRow.provider)
                ] ?? false
              }
              loading={credLoading}
              canSave={
                profileDirty ||
                (
                  keyInputs[
                    selectedRow.apiKeyEnv ?? deriveKeyRef(selectedRow.provider)
                  ] ?? ""
                ).trim().length > 0 ||
                // 添加态且已检测到密钥（如环境变量）时可直接注册，无需重录
                (addingProvider &&
                  !selectedIsAdded &&
                  selectedRow.credentialConfigured === true)
              }
              onInputChange={(ref, value) =>
                setKeyInputs((prev) => ({ ...prev, [ref]: value }))
              }
              onToggleVisible={(ref) =>
                setKeyVisible((prev) => ({
                  ...prev,
                  [ref]: !(prev[ref] ?? false),
                }))
              }
              onSave={() => void handleSaveProvider(selectedRow)}
              onUnset={(ref) => void handleUnsetCredential(ref)}
              onDelete={
                isSelectedRemovable
                  ? () => void handleDeleteProvider(selectedRow)
                  : undefined
              }
            />
          ) : (
            <div className="native-provider-picker">
              <button
                type="button"
                className="native-provider-card native-provider-card-custom"
                onClick={() => {
                  setIsAddingCustom(true);
                  setSelectedProvider(null);
                }}
                title={t("settings.models.addCustom")}
              >
                <span className="native-provider-card-body">
                  <span className="native-provider-card-name">
                    + {t("settings.models.addCustom")}
                  </span>
                  <span className="native-provider-picker-hint">
                    {t("settings.models.addCustomHint")}
                  </span>
                </span>
              </button>
              {availableRows.length === 0 ? (
                <div className="native-model-empty">
                  {t("settings.models.allBuiltInAdded")}
                </div>
              ) : (
                availableRows.map((row) => {
                  const name = providerDisplayName(
                    row.provider,
                    row.displayName,
                  );
                  return (
                    <button
                      key={row.provider}
                      type="button"
                      className="native-provider-card"
                      onClick={() => setSelectedProvider(row.provider)}
                      title={row.provider}
                    >
                      <span className="native-provider-card-body">
                        <span className="native-provider-card-name">
                          {name}
                        </span>
                        {row.credentialConfigured && (
                          <span className="native-provider-card-hint">
                            {t("settings.models.keyDetected")}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* 新会话默认模型（引擎 agent-default-model 命名空间） */}
      {modelOptions.length > 0 && (
        <div className="native-settings-card">
          <SettingsRow
            label={t("settings.models.defaultModel.label")}
            desc={t("settings.models.defaultModel.desc")}
          >
            <select
              className="native-settings-select"
              value={dsh.defaultModelKey}
              onChange={(e) => void dsh.saveDefaultModel(e.target.value)}
            >
              <option value="">
                {t("settings.models.defaultModel.followEngine")}
              </option>
              {modelOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingsRow>
        </div>
      )}
    </>
  );
}
