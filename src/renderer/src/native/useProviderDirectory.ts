import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Endpoints,
  type ConfigurableProviderEntry,
  type CredentialInfo,
  type RegisteredProvider,
  type SettingsDescribeValue,
  type SettingsNamespaceView,
} from "./protocol";
import { rpc } from "./rpc";
import { providerDisplayName } from "./provider-brand";
import {
  deriveKeyRef,
  familyOf,
  joinProviderDirectory,
  pathOps,
  schemaUnionChoices,
  stringAt,
  userSubtreeAt,
  valueAtPath,
  type CustomModelEntry,
  type ProviderRow,
} from "./settings-domain";

/** 模型设置分区的供应商目录、凭据与用户段草稿控制器。 */
export interface ProviderDirectory {
  providerRows: ProviderRow[];
  /** 已添加 = 引擎已注册路由，与聊天框模型选择器同一数据源。 */
  addedRows: ProviderRow[];
  /** 可选供应商：已检测到密钥的排前面，其余按展示名排序。 */
  availableRows: ProviderRow[];
  selectedProvider: string | null;
  /** 侧栏已添加项点击：选中并退出添加流程。 */
  selectProvider: (provider: string) => void;
  /** 原始选中（添加流程中的「可选供应商」卡片点击，不重置添加状态）。 */
  setSelectedProvider: Dispatch<SetStateAction<string | null>>;
  selectedRow: ProviderRow | null;
  selectedIsAdded: boolean;
  selectedView: SettingsNamespaceView | undefined;
  isSelectedRemovable: boolean;
  /** 添加流程进行中：详情区展示「可选供应商」选择器或被选中的未配置供应商。 */
  addingProvider: boolean;
  setAddingProvider: (next: boolean) => void;
  /** 自定义服务商添加进行中。 */
  isAddingCustom: boolean;
  setIsAddingCustom: (next: boolean) => void;
  isAddingFlow: boolean;
  startAddingFlow: () => void;
  exitAddingFlow: () => void;
  keyInputs: Record<string, string>;
  setKeyInputs: Dispatch<SetStateAction<Record<string, string>>>;
  keyVisible: Record<string, boolean>;
  setKeyVisible: Dispatch<SetStateAction<Record<string, boolean>>>;
  credLoading: boolean;
  credMessage: string | null;
  llmViews: Record<string, SettingsNamespaceView>;
  settingsWritable: boolean;
  /** 选中供应商的用户段草稿（完整子树副本）。 */
  draft: Record<string, unknown>;
  /** 草稿相对用户段基线是否有未保存修改。 */
  profileDirty: boolean;
  setDraftField: (key: string, value: unknown) => void;
  loadProviders: () => Promise<void>;
  handleUnsetCredential: (ref: string) => Promise<void>;
  handleSaveCustom: (data: {
    route: string;
    displayName?: string;
    api: string;
    baseURL: string;
    apiKey?: string;
    models: CustomModelEntry[];
  }) => Promise<void>;
  handleDeleteProvider: (row: ProviderRow) => Promise<void>;
  handleSaveProvider: (row: ProviderRow) => Promise<void>;
}

/** 自声明路由可选择的 API 协议；schema 不可用时回退到常见协议清单。 */
export function useAvailableProtocols(
  llmViews: Record<string, SettingsNamespaceView>,
): string[] {
  return useMemo(() => {
    const piAi = llmViews["llm-pi-ai"];
    const choices = schemaUnionChoices(piAi?.schema, [
      "providers",
      "\u0000probe",
      "api",
    ]);
    return choices.length > 0
      ? choices
      : [
          "openai-completions",
          "anthropic-messages",
          "google-generative-ai",
          "mistral-chat",
        ];
  }, [llmViews]);
}

export function useProviderDirectory(options: {
  onRefreshCatalog?: () => void;
}): ProviderDirectory {
  const { onRefreshCatalog } = options;

  const [providerRows, setProviderRows] = useState<ProviderRow[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});
  const [credLoading, setCredLoading] = useState(false);
  const [credMessage, setCredMessage] = useState<string | null>(null);
  /** llm-* 设置命名空间视图（profile 解析值、用户段与修订号）。 */
  const [llmViews, setLlmViews] = useState<
    Record<string, SettingsNamespaceView>
  >({});
  const [settingsWritable, setSettingsWritable] = useState(true);
  /**
   * 选中供应商的用户段草稿与基线。键含供应商与修订号：选中变化或写入落盘
   * （修订号递增）时重建草稿；本地编辑期间外部并发变更也以引擎为准。
   */
  const [draftStore, setDraftStore] = useState<{
    key: string;
    baseline: Record<string, unknown>;
    draft: Record<string, unknown>;
  }>({ key: "", baseline: {}, draft: {} });

  // 读取供应商目录并入凭据状态：目录 join → profile 的 apiKeyEnv → 一次批量凭据 describe
  const loadProviders = useCallback(async () => {
    try {
      const [registered, declared, described] = await Promise.all([
        rpc<RegisteredProvider[]>(Endpoints.llmListProviders, {}),
        rpc<ConfigurableProviderEntry[]>(
          Endpoints.llmListConfigurableProviders,
          {},
        ),
        rpc<SettingsDescribeValue>(Endpoints.settingsDescribe, {}),
      ]);
      const namespaces = new Map(
        described.namespaces.map((view) => [view.ns, view]),
      );
      setSettingsWritable(described.writable);
      const views: Record<string, SettingsNamespaceView> = {};
      for (const view of described.namespaces) {
        if (view.ns.startsWith("llm-")) views[view.ns] = view;
      }
      setLlmViews(views);
      const rows = joinProviderDirectory(registered, declared).map((row) => {
        const profile = valueAtPath(
          namespaces.get(row.settingsNs)?.value,
          row.settingsPath,
        );
        const env =
          typeof profile === "object" &&
          profile !== null &&
          typeof (profile as Record<string, unknown>).apiKeyEnv === "string" &&
          ((profile as Record<string, unknown>).apiKeyEnv as string).length > 0
            ? ((profile as Record<string, unknown>).apiKeyEnv as string)
            : undefined;
        return env === undefined ? row : { ...row, apiKeyEnv: env };
      });
      const refs = [
        ...new Set(
          rows.map((row) => row.apiKeyEnv ?? deriveKeyRef(row.provider)),
        ),
      ];
      let credentials: Record<string, CredentialInfo> = {};
      if (refs.length > 0) {
        credentials = await rpc<Record<string, CredentialInfo>>(
          Endpoints.credentialsDescribe,
          { refs },
        );
      }
      const joined = rows.map((row) => ({
        ...row,
        credentialConfigured: Boolean(
          credentials[row.apiKeyEnv ?? deriveKeyRef(row.provider)]?.configured,
        ),
      }));
      setProviderRows(joined);
      setSelectedProvider((prev) => {
        if (prev !== null && joined.some((row) => row.provider === prev)) {
          return prev;
        }
        // 默认落在第一个已添加（已注册路由）的供应商，否则交给选择器
        const firstAdded = joined.find((row) => row.active);
        return firstAdded?.provider ?? null;
      });
    } catch (e) {
      console.error("[SettingsPage] 读取供应商目录失败", e);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  // 清除 / 删除 API Key
  const handleUnsetCredential = useCallback(
    async (ref: string) => {
      try {
        setCredLoading(true);
        setCredMessage(null);
        await rpc<void>(Endpoints.credentialsUnset, { ref });
        setKeyInputs((prev) => ({ ...prev, [ref]: "" }));
        setCredMessage(`凭据 ${ref} 已清除`);
        await loadProviders();
        onRefreshCatalog?.();
      } catch (e) {
        setCredMessage(
          `清除失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setCredLoading(false);
      }
    },
    [loadProviders, onRefreshCatalog],
  );

  // 添加自定义服务商保存
  const handleSaveCustom = useCallback(
    async (data: {
      route: string;
      displayName?: string;
      api: string;
      baseURL: string;
      apiKey?: string;
      models: CustomModelEntry[];
    }) => {
      try {
        setCredLoading(true);
        setCredMessage(null);
        const keyRef = deriveKeyRef(data.route);
        const storesKey = (data.apiKey ?? "").trim().length > 0;
        const profile = {
          ...(data.displayName ? { displayName: data.displayName } : {}),
          ...(storesKey ? { apiKeyEnv: keyRef } : {}),
          api: data.api,
          baseURL: data.baseURL.trim(),
          models: data.models.map((m) => ({
            id: m.id,
            ...(m.name && m.name !== m.id ? { name: m.name } : {}),
            ...(m.reasoning ? { reasoning: true } : {}),
          })),
        };
        const piAiView = llmViews["llm-pi-ai"];
        await rpc(Endpoints.settingsMutate, {
          ns: "llm-pi-ai",
          ops: [
            {
              op: "set",
              path: ["providers", data.route],
              value: profile,
            },
          ],
          expectedRevision: piAiView?.revision,
        });
        if (storesKey) {
          await rpc<void>(Endpoints.credentialsSet, {
            ref: keyRef,
            value: data.apiKey!.trim(),
          });
        }
        setCredMessage(
          `自定义服务商「${data.displayName || data.route}」添加成功`,
        );
        await loadProviders();
        onRefreshCatalog?.();
        setIsAddingCustom(false);
        setAddingProvider(false);
        setSelectedProvider(data.route);
      } catch (err) {
        setCredMessage(
          `添加失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setCredLoading(false);
      }
    },
    [llmViews, loadProviders, onRefreshCatalog],
  );

  // 删除服务商（包括自定义服务商与用户添加的预设服务商）
  const handleDeleteProvider = useCallback(
    async (row: ProviderRow) => {
      const name = row.displayName || row.provider;
      const confirmed = window.confirm(
        `确定要删除服务商「${name}」吗？相关配置与凭据将被移除。`,
      );
      if (!confirmed) return;
      try {
        setCredLoading(true);
        setCredMessage(null);
        const ref = row.apiKeyEnv ?? deriveKeyRef(row.provider);
        if (row.credentialConfigured) {
          try {
            await rpc<void>(Endpoints.credentialsUnset, { ref });
          } catch {
            // 忽略凭据未配置错误
          }
        }
        setKeyInputs((prev) => {
          const next = { ...prev };
          delete next[ref];
          return next;
        });
        const view = row.settingsNs ? llmViews[row.settingsNs] : undefined;
        await rpc(Endpoints.settingsMutate, {
          ns: row.settingsNs || "llm-pi-ai",
          ops: [
            {
              op: "unset",
              path:
                row.settingsPath.length > 0
                  ? row.settingsPath
                  : ["providers", row.provider],
            },
          ],
          expectedRevision: view?.revision,
        });
        setCredMessage(`服务商 ${name} 已删除`);
        setSelectedProvider((prev) => (prev === row.provider ? null : prev));
        await loadProviders();
        onRefreshCatalog?.();
      } catch (err) {
        setCredMessage(
          `删除失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setCredLoading(false);
      }
    },
    [llmViews, loadProviders, onRefreshCatalog],
  );

  // 已添加 = 引擎已注册路由，与聊天框模型选择器同一数据源
  const addedRows = useMemo(
    () => providerRows.filter((row) => row.active),
    [providerRows],
  );
  // 可选供应商：已检测到密钥的排前面，其余按展示名排序
  const availableRows = useMemo(
    () =>
      providerRows
        .filter((row) => !row.active)
        .sort((a, b) => {
          if (a.credentialConfigured !== b.credentialConfigured) {
            return a.credentialConfigured ? -1 : 1;
          }
          return providerDisplayName(a.provider, a.displayName).localeCompare(
            providerDisplayName(b.provider, b.displayName),
            "zh",
          );
        }),
    [providerRows],
  );

  const selectedRow =
    providerRows.find((row) => row.provider === selectedProvider) ?? null;
  const selectedIsAdded = selectedRow
    ? addedRows.some((row) => row.provider === selectedRow.provider)
    : false;
  const selectedView = selectedRow
    ? llmViews[selectedRow.settingsNs]
    : undefined;

  /**
   * 是否允许删除：除核心 DeepSeek 提供商外，用户已添加配置（或自声明）的提供商均可删除移除，
   * 删除后将清理凭据并从引擎路由注销，预设服务商将返回待选库。
   */
  const isSelectedRemovable = Boolean(
    selectedRow &&
    selectedRow.provider !== "deepseek" &&
    selectedRow.provider !== "deepseek-official" &&
    (selectedRow.settingsPath.length > 0 || selectedRow.declared) &&
    (selectedIsAdded || selectedRow.declared),
  );

  // 草稿重建：供应商切换或写入落盘（修订号递增）时，以引擎用户段为基线重新开稿
  const draftKey = `${selectedProvider ?? ""}|${selectedView?.revision ?? ""}`;
  if (draftStore.key !== draftKey) {
    const baseline = userSubtreeAt(
      selectedView,
      selectedRow?.settingsPath ?? [],
    );
    setDraftStore({
      key: draftKey,
      baseline,
      draft: structuredClone(baseline),
    });
  }
  const profileDirty =
    draftStore.key === draftKey &&
    JSON.stringify(draftStore.draft) !== JSON.stringify(draftStore.baseline);

  const setDraftField = useCallback((key: string, value: unknown) => {
    setDraftStore((store) => {
      const draft = { ...store.draft };
      if (typeof value === "string" && value.trim() === "") delete draft[key];
      else if (value === undefined) delete draft[key];
      else draft[key] = value;
      return { ...store, draft };
    });
  }, []);

  // 统一保存：profile 的最小路径操作（settings/mutate）+ 新密钥（credentials/set）一次提交
  const handleSaveProvider = useCallback(
    async (row: ProviderRow) => {
      const ref = row.apiKeyEnv ?? deriveKeyRef(row.provider);
      const rawKey = (keyInputs[ref] ?? "").trim();
      const view = row.settingsNs ? llmViews[row.settingsNs] : undefined;
      const draft = { ...draftStore.draft };
      // pi-ai：输入了密钥而前后层都没有 apiKeyEnv 时物化派生引用（官方 applyOnce 语义）；
      // 添加态凭据已就绪（如来自环境变量或安全区）时同样物化，仅注册路由不重录密钥
      if (
        familyOf(row.settingsNs) === "pi-ai" &&
        (rawKey.length > 0 || row.credentialConfigured === true) &&
        stringAt(draft, "apiKeyEnv") === undefined &&
        stringAt(valueAtPath(view?.value, row.settingsPath), "apiKeyEnv") ===
          undefined
      ) {
        draft.apiKeyEnv = ref;
      }
      const ops = pathOps(row.settingsPath, draftStore.baseline, draft);
      if (ops.length === 0 && rawKey.length === 0) return;
      try {
        setCredLoading(true);
        setCredMessage(null);
        if (ops.length > 0) {
          await rpc(Endpoints.settingsMutate, {
            ns: row.settingsNs,
            ops,
            expectedRevision: view?.revision,
          });
        }
        if (rawKey.length > 0) {
          await rpc<void>(Endpoints.credentialsSet, { ref, value: rawKey });
        }
        setKeyInputs((prev) => ({ ...prev, [ref]: "" }));
        setCredMessage(`供应商 ${row.displayName} 已保存`);
        await loadProviders();
        onRefreshCatalog?.();
        setAddingProvider(false);
      } catch (e) {
        setCredMessage(
          `保存失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setCredLoading(false);
      }
    },
    [draftStore, keyInputs, llmViews, loadProviders, onRefreshCatalog],
  );

  // 添加供应商流程：进入与退出（退出时回落到第一个已添加供应商）
  const isAddingFlow = addingProvider || isAddingCustom;
  const startAddingFlow = useCallback(() => {
    setAddingProvider(true);
    setIsAddingCustom(false);
    setSelectedProvider(null);
  }, []);
  const exitAddingFlow = useCallback(() => {
    setAddingProvider(false);
    setIsAddingCustom(false);
    setSelectedProvider(addedRows[0]?.provider ?? null);
  }, [addedRows]);

  const selectProvider = useCallback((provider: string) => {
    setAddingProvider(false);
    setIsAddingCustom(false);
    setSelectedProvider(provider);
  }, []);

  return {
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
    llmViews,
    settingsWritable,
    draft: draftStore.draft,
    profileDirty,
    setDraftField,
    loadProviders,
    handleUnsetCredential,
    handleSaveCustom,
    handleDeleteProvider,
    handleSaveProvider,
  };
}
