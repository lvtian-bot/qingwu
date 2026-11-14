import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useT } from "../i18n";
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
  stringAt,
  userSubtreeAt,
  valueAtPath,
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
  handleDeleteProvider: (row: ProviderRow) => Promise<void>;
  handleSaveProvider: (row: ProviderRow) => Promise<void>;
}

/** DeepSeek 账号登录通道的引擎路由 id（与桌面版同一 id）。 */
const ACCOUNT_PROVIDER = "deepseek-account";

/**
 * 已添加列表的排序权重：账号通道第一、内置 DeepSeek 第二，其余保持目录顺序。
 * 与桌面版 ModelsSection 的排序规则一致。
 */
function providerRank(provider: string): number {
  if (provider === ACCOUNT_PROVIDER) return 0;
  if (provider === "deepseek-official") return 1;
  return 2;
}

export function useProviderDirectory(options: {
  onRefreshCatalog?: () => void;
  externalRefreshTrigger?: number;
  /**
   * DeepSeek 账号通道是否已登录可用。与桌面版一致：以模型目录里该通道是否有
   * 模型为准，未登录时整条通道不呈现，避免出现只能填密钥的伪供应商。
   */
  accountAvailable?: boolean;
}): ProviderDirectory {
  const { onRefreshCatalog, externalRefreshTrigger } = options;
  const accountAvailable = options.accountAvailable === true;
  const t = useT();

  const [providerRows, setProviderRows] = useState<ProviderRow[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
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

  /** 目录加载代次：保存搜索凭据会触发外部刷新，两次加载可能重叠，
   * 只有最新一次的回执允许发布状态，防止旧回执把界面覆盖回旧凭据。 */
  const loadGenRef = useRef(0);
  /** 账号通道可用性在默认选中里使用：loadProviders 的依赖不应随登录状态重建。 */
  const accountAvailableRef = useRef(accountAvailable);
  accountAvailableRef.current = accountAvailable;

  // 读取供应商目录并入凭据状态：目录 join → profile 的 apiKeyEnv → 一次批量凭据 describe
  const loadProviders = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      const [registered, declared, described] = await Promise.all([
        rpc<RegisteredProvider[]>(Endpoints.llmListProviders, {}),
        rpc<ConfigurableProviderEntry[]>(
          Endpoints.llmListConfigurableProviders,
          {},
        ),
        rpc<SettingsDescribeValue>(Endpoints.settingsDescribe, {}),
      ]);
      if (gen !== loadGenRef.current) return;
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
        if (gen !== loadGenRef.current) return;
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
        // 默认落在第一个已添加（已注册路由）的供应商，否则交给选择器；
        // 未登录的账号通道不参与默认选中，避免详情区落在不可配置的通道上
        const firstAdded = joined.find(
          (row) =>
            row.active &&
            (row.provider !== ACCOUNT_PROVIDER ||
              accountAvailableRef.current),
        );
        return firstAdded?.provider ?? null;
      });
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      console.error("[SettingsPage] 读取供应商目录失败", e);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (externalRefreshTrigger) {
      void loadProviders();
    }
  }, [externalRefreshTrigger, loadProviders]);

  // 删除服务商（包括自定义服务商与用户添加的预设服务商）
  const handleDeleteProvider = useCallback(
    async (row: ProviderRow) => {
      const name = row.displayName || row.provider;
      const confirmed = window.confirm(
        t("settings.messages.confirmDelete", { name }),
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
        setCredMessage(t("settings.messages.providerDeleted", { name }));
        setSelectedProvider((prev) => (prev === row.provider ? null : prev));
        await loadProviders();
        onRefreshCatalog?.();
      } catch (err) {
        setCredMessage(
          t("settings.messages.deleteFailed", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        setCredLoading(false);
      }
    },
    [llmViews, loadProviders, onRefreshCatalog, t],
  );

  // 已添加 = 引擎已注册路由，与聊天框模型选择器同一数据源
  // 账号通道未登录时整条不呈现（桌面版同样按可用性过滤），其余按原目录顺序保留
  const visibleRows = useMemo(
    () =>
      providerRows.filter(
        (row) => row.provider !== ACCOUNT_PROVIDER || accountAvailable,
      ),
    [providerRows, accountAvailable],
  );
  // 已添加列表按桌面版权重排序：账号 → 内置 DeepSeek → 其余保持目录顺序
  const addedRows = useMemo(
    () =>
      visibleRows
        .filter((row) => row.active)
        .sort((a, b) => providerRank(a.provider) - providerRank(b.provider)),
    [visibleRows],
  );
  // 可选供应商：已检测到密钥的排前面，其余按展示名排序
  const availableRows = useMemo(
    () =>
      visibleRows
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
    [visibleRows],
  );

  const selectedRow =
    visibleRows.find((row) => row.provider === selectedProvider) ?? null;
  const selectedIsAdded = selectedRow
    ? addedRows.some((row) => row.provider === selectedRow.provider)
    : false;
  const selectedView = selectedRow
    ? llmViews[selectedRow.settingsNs]
    : undefined;

  // 账号通道从可用变为不可用（退出登录/目录刷新后无模型）时，选中回落到首个已添加供应商
  useEffect(() => {
    if (accountAvailable) return;
    setSelectedProvider((prev) => {
      if (prev !== ACCOUNT_PROVIDER) return prev;
      const fallback = providerRows.find(
        (row) => row.active && row.provider !== ACCOUNT_PROVIDER,
      );
      return fallback?.provider ?? null;
    });
  }, [accountAvailable, providerRows]);

  /**
   * 是否允许删除：与桌面版一致，只看「这条配置是否由用户在配置层添加」——
   * 内置供应商的 settingsPath 为空、不可删；用户添加的预设与自定义服务商可删，
   * 删除时一并清理凭据（见 handleDeleteProvider）。
   */
  const isSelectedRemovable = Boolean(
    selectedRow &&
    selectedRow.settingsPath.length > 0 &&
    (selectedIsAdded || selectedRow.declared === true),
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
        setCredMessage(
          t("settings.messages.providerSaved", { name: row.displayName }),
        );
        await loadProviders();
        onRefreshCatalog?.();
        setAddingProvider(false);
      } catch (e) {
        setCredMessage(
          t("settings.messages.saveFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      } finally {
        setCredLoading(false);
      }
    },
    [draftStore, keyInputs, llmViews, loadProviders, onRefreshCatalog, t],
  );

  // 添加供应商流程：进入与退出（退出时回落到第一个已添加供应商）
  const isAddingFlow = addingProvider;
  const startAddingFlow = useCallback(() => {
    setAddingProvider(true);
    setSelectedProvider(null);
  }, []);
  const exitAddingFlow = useCallback(() => {
    setAddingProvider(false);
    setSelectedProvider(addedRows[0]?.provider ?? null);
  }, [addedRows]);

  const selectProvider = useCallback((provider: string) => {
    setAddingProvider(false);
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
    handleDeleteProvider,
    handleSaveProvider,
  };
}
