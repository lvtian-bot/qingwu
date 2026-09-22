import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppSettings } from "../../../shared/types";
import {
  Endpoints,
  type ConfigurableProviderEntry,
  type CredentialInfo,
  type LlmDiscoveredModel,
  type LlmModelDiscoveryRequest,
  type ModelCatalog,
  type ModelCatalogModel,
  type RegisteredProvider,
  type SettingsDescribeValue,
  type SettingsNamespaceView,
  type SettingsPathOp,
} from "./protocol";
import { rpc } from "./rpc";
import { providerDisplayName } from "./provider-brand";
import type { PanelWidth } from "./usePanelWidth";

export interface SettingsPageProps {
  onBack: () => void;
  /** 侧栏宽度控制器：与主界面侧栏共用同一实例，宽度与拖拽互相联动。 */
  sidebarPanel: PanelWidth;
  modelCatalog?: ModelCatalog | null;
  /** 凭据变化后刷新引擎模型目录（供应商注册与模型清单随之更新）。 */
  onRefreshCatalog?: () => void;
  dshConnected?: boolean;
  reconnecting?: boolean;
  onReconnect?: () => void;
}

type TabKey = "models" | "general" | "permissions";

/** 供应商目录行：官方 settings-models 的 joinProviderDirectory 语义移植。 */
interface ProviderRow {
  provider: string;
  displayName: string;
  settingsNs: string;
  settingsPath: string[];
  active: boolean;
  /** 自声明路由（适配器未内置、完全由用户配置声明，如自定义网关）。 */
  declared?: boolean;
  error?: string;
  /** 供应商 profile 显式声明的凭据引用（apiKeyEnv）。 */
  apiKeyEnv?: string;
  /** 命名/派生凭据引用当前是否已配置。 */
  credentialConfigured?: boolean;
}

/** 派生供应商路由的常规凭据引用（与官方 deriveKeyRef 一致，如 minimax-cn → MINIMAX_CN_API_KEY）。 */
function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/** 声明目录与已注册路由 join：声明行在前，未声明的存活路由补在后。 */
function joinProviderDirectory(
  registered: RegisteredProvider[],
  directory: ConfigurableProviderEntry[],
): ProviderRow[] {
  const active = new Set(registered.map((p) => p.id));
  const declared = new Set(directory.map((e) => e.provider));
  const rows: ProviderRow[] = directory.map((entry) => ({
    provider: entry.provider,
    displayName: entry.displayName,
    settingsNs: entry.settingsNs,
    settingsPath: [...entry.settingsPath],
    active: active.has(entry.provider),
    ...(entry.declared === undefined ? {} : { declared: entry.declared }),
    ...(entry.error === undefined ? {} : { error: entry.error }),
  }));
  for (const provider of registered) {
    if (declared.has(provider.id)) continue;
    rows.push({
      provider: provider.id,
      displayName: provider.name,
      settingsNs: "",
      settingsPath: [],
      active: true,
    });
  }
  return rows;
}

/** 沿路径读取设置值内的嵌套对象（空路径返回原值）。 */
function valueAtPath(value: unknown, path: string[]): unknown {
  let node = value;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** 对象字段里的非空字符串（空串视同未设置，与官方 stringAt 一致）。 */
function stringAt(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

/** 供应商所属适配器家族：决定详情区可编辑字段与占位文案。 */
function familyOf(settingsNs: string): "deepseek" | "pi-ai" | "unknown" {
  if (settingsNs === "llm-deepseek") return "deepseek";
  if (settingsNs === "llm-pi-ai") return "pi-ai";
  return "unknown";
}

/** 命名空间用户段在路径上的子树副本（无覆盖时为空对象）；编辑草稿取自这里。 */
function userSubtreeAt(
  view: SettingsNamespaceView | undefined,
  path: string[],
): Record<string, unknown> {
  const node = valueAtPath(view?.user, path);
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return {};
  }
  return structuredClone(node) as Record<string, unknown>;
}

/**
 * 草稿相对用户段基线的最小 set/unset 路径操作（官方 pathOps 移植）：
 * 只命名卡片见过的键，未触及字段不产生操作，避免整段重建覆盖他处配置。
 */
function pathOps(
  base: string[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SettingsPathOp[] {
  const ops: SettingsPathOp[] = [];
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) {
      ops.push({ op: "set", path: [...base, key], value });
    }
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) ops.push({ op: "unset", path: [...base, key] });
  }
  return ops;
}

/**
 * 从序列化 schema 包络（{uid, refs}）解析自声明路由可用的 API 协议枚举：
 * 官方 protocolChoices 语义——沿 ["providers", 探针路由, "api"] 走到 union 节点，
 * 选项与适配器接受值同源，不会漂移。
 */
function schemaUnionChoices(schema: unknown, path: string[]): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const refs = (schema as { refs?: unknown }).refs;
  if (typeof refs !== "object" || refs === null) return [];
  const refTable = refs as Record<string, unknown>;
  const deref = (node: unknown): unknown => {
    let current = node;
    while (typeof current === "string" || typeof current === "number") {
      const next = refTable[String(current)];
      if (next === undefined) return undefined;
      current = next;
    }
    return current;
  };
  let node = deref((schema as { uid?: unknown }).uid);
  for (const key of path) {
    node = deref(node);
    if (typeof node !== "object" || node === null) return [];
    const record = node as Record<string, unknown>;
    if (record.type === "dict") {
      node = record.inner;
    } else if (
      typeof record.dict === "object" &&
      record.dict !== null &&
      key in (record.dict as Record<string, unknown>)
    ) {
      node = (record.dict as Record<string, unknown>)[key];
    } else if (
      typeof record.properties === "object" &&
      record.properties !== null &&
      key in (record.properties as Record<string, unknown>)
    ) {
      node = (record.properties as Record<string, unknown>)[key];
    } else {
      return [];
    }
  }
  node = deref(node);
  if (typeof node !== "object" || node === null) return [];
  const union = node as { type?: unknown; list?: unknown };
  if (union.type !== "union" || !Array.isArray(union.list)) return [];
  return union.list
    .map((entry) => deref(entry))
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).value === "string",
    )
    .map((entry) => entry.value as string);
}

const NAV_GROUPS: {
  title: string;
  items: { key: TabKey; label: string; icon: ReactNode }[];
}[] = [
  {
    title: "基础设置",
    items: [
      {
        key: "general",
        label: "常规",
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM9.75 8a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z" />
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.185 1.184l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.185l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
          </svg>
        ),
      },
      {
        key: "models",
        label: "模型设置",
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H2.5A1.5 1.5 0 0 0 1 4.5v9A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 3H11v-.5A1.5 1.5 0 0 0 9.5 1h-3zm0 1h3a.5.5 0 0 1 .5.5V3H6v-.5a.5.5 0 0 1 .5-.5zM2 4.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V6H2V4.5zM2 7h12v6.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V7z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Agent 能力",
    items: [
      {
        key: "permissions",
        label: "权限",
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 1l5.5 2v4.2c0 3.4-2.3 6.3-5.5 7.3-3.2-1-5.5-3.9-5.5-7.3V3L8 1z" />
          </svg>
        ),
      },
    ],
  },
];

/** 行式设置项：标题与描述在左，控件在右。 */
function SettingsRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="native-settings-row">
      <div className="native-settings-row-text">
        <div className="native-settings-row-title">{label}</div>
        <div className="native-settings-row-desc">{desc}</div>
      </div>
      <div className="native-settings-row-control">{children}</div>
    </div>
  );
}

function SettingsSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`native-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="native-switch-knob" />
    </button>
  );
}

interface CustomModelEntry {
  id: string;
  name?: string;
  reasoning?: boolean;
}

const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** 候选模型多选弹层：从服务商接口拉取成功后供用户勾选添加。 */
function CandidateModelPicker(props: {
  candidates: LlmDiscoveredModel[];
  onAdd: (selected: LlmDiscoveredModel[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(props.candidates.map((c) => c.id)),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.candidates;
    return props.candidates.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        (c.name && c.name.toLowerCase().includes(q)),
    );
  }, [props.candidates, query]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  const toggleAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const c of filtered) next.delete(c.id);
      } else {
        for (const c of filtered) next.add(c.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    const chosen = props.candidates.filter((c) => selectedIds.has(c.id));
    props.onAdd(chosen);
  };

  return (
    <div className="native-model-picker-overlay" onClick={props.onClose}>
      <div
        className="native-model-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="native-model-picker-header">
          <div className="native-model-picker-title">
            选择要添加的模型 ({filtered.length} / {props.candidates.length})
          </div>
          <button
            type="button"
            className="native-model-picker-close"
            onClick={props.onClose}
            title="关闭"
          >
            ×
          </button>
        </div>
        <div className="native-model-picker-search-row">
          <input
            type="text"
            className="native-settings-input"
            placeholder="搜索模型 ID 或名称..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={toggleAllFiltered}
          >
            {allFilteredSelected ? "取消全选" : "全选"}
          </button>
        </div>
        <div className="native-model-picker-list">
          {filtered.length === 0 ? (
            <div className="native-model-empty">无匹配模型</div>
          ) : (
            filtered.map((c) => (
              <label
                key={c.id}
                className={`native-model-picker-item ${
                  selectedIds.has(c.id) ? "selected" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleOne(c.id)}
                />
                <div className="native-model-picker-info">
                  <div className="native-model-picker-name">
                    {c.name || c.id}
                    {c.name && c.name !== c.id && (
                      <span className="native-model-id">{c.id}</span>
                    )}
                  </div>
                  {c.contextWindow && (
                    <div className="native-model-picker-meta">
                      上下文: {c.contextWindow.toLocaleString()} tokens
                    </div>
                  )}
                </div>
              </label>
            ))
          )}
        </div>
        <div className="native-model-picker-footer">
          <span className="native-model-picker-count">
            已选 {selectedIds.size} 个模型
          </span>
          <div className="native-model-picker-actions">
            <button
              type="button"
              className="native-btn native-btn-secondary"
              onClick={props.onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="native-btn native-btn-primary"
              disabled={selectedIds.size === 0}
              onClick={handleConfirm}
            >
              添加所选
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 添加自定义服务商表单面板。 */
function CustomProviderCreate(props: {
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
  const [candidateModels, setCandidateModels] = useState<
    LlmDiscoveredModel[] | null
  >(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

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

  const handleFetchModels = async () => {
    if (!cleanBaseURL || !isHttpUrl(cleanBaseURL)) {
      setFetchError("请先输入有效的接口地址 (HTTP/HTTPS URL)");
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const discReq: LlmModelDiscoveryRequest = {
        baseURL: cleanBaseURL,
        api: api || undefined,
      };
      if (apiKey.trim()) {
        discReq.apiKey = apiKey.trim();
      }
      const res = await rpc<LlmDiscoveredModel[]>(Endpoints.llmDiscoverModels, {
        settingsNs: "llm-pi-ai",
        request: discReq,
      });
      if (!res || res.length === 0) {
        setFetchError("服务商接口未返回任何候选模型，请手动输入添加");
      } else {
        setCandidateModels(res);
      }
    } catch (err) {
      setFetchError(
        `获取失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFetching(false);
    }
  };

  const handleAddCandidates = (chosen: LlmDiscoveredModel[]) => {
    const existing = new Set(models.map((m) => m.id));
    const toAdd: CustomModelEntry[] = [];
    for (const c of chosen) {
      if (!existing.has(c.id)) {
        toAdd.push({
          id: c.id,
          name: c.name && c.name !== c.id ? c.name : undefined,
        });
      }
    }
    setModels((prev) => [...prev, ...toAdd]);
    setCandidateModels(null);
  };

  const handleAddManualModel = () => {
    const id = newModelId.trim();
    if (!id) return;
    if (models.some((m) => m.id === id)) {
      setFetchError(`模型 ID「${id}」已在列表中`);
      return;
    }
    setModels((prev) => [
      ...prev,
      {
        id,
        name: newModelName.trim() ? newModelName.trim() : undefined,
        reasoning: newModelReasoning || undefined,
      },
    ]);
    setNewModelId("");
    setNewModelName("");
    setNewModelReasoning(false);
    setFetchError(null);
  };

  const handleRemoveModel = (id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div className="native-provider-detail">
      {candidateModels && (
        <CandidateModelPicker
          candidates={candidateModels}
          onAdd={handleAddCandidates}
          onClose={() => setCandidateModels(null)}
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
        声明一条由用户自行配置的 LLM 路由，支持自建网关或 OpenAI / Anthropic 兼容端点。
      </div>

      {fetchError && <div className="native-provider-error">{fetchError}</div>}

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
          <button
            type="button"
            className="native-provider-visible-toggle"
            onClick={() => setKeyVisible(!keyVisible)}
            title={keyVisible ? "隐藏密钥" : "显示密钥"}
          >
            {keyVisible ? (
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
              >
                <path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7.029 7.029 0 0 0 2.79-.588zM5.21 3.088A7.028 7.028 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474L5.21 3.089z" />
                <path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829l-2.83-2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171-5.006a.75.75 0 0 1 1.06 1.06l-12 12a.75.75 0 0 1-1.06-1.06l12-12z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
              >
                <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z" />
                <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z" />
              </svg>
            )}
          </button>
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
              disabled={fetching || !cleanBaseURL || baseUrlInvalid}
              onClick={handleFetchModels}
              title={cleanBaseURL ? "从接口拉取候选模型" : "请先输入有效的接口地址"}
            >
              {fetching ? "获取中..." : "获取可用模型"}
            </button>
          </div>
        </div>

        {models.length === 0 ? (
          <div className="native-model-empty">
            尚未添加模型。请点击「获取可用模型」从服务商拉取，或在下方手动添加。
          </div>
        ) : (
          models.map((model) => (
            <div key={model.id} className="native-model-item">
              <div className="native-settings-row-text">
                <div className="native-model-name">
                  {model.name || model.id}
                  {model.name && model.name !== model.id && (
                    <span className="native-model-id">{model.id}</span>
                  )}
                </div>
              </div>
              <div className="native-model-item-side">
                {model.reasoning && (
                  <span className="native-model-tag">推理</span>
                )}
                <button
                  type="button"
                  className="native-model-remove-btn"
                  onClick={() => handleRemoveModel(model.id)}
                  title="移除模型"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}

        <div className="native-model-add-row">
          <input
            type="text"
            className="native-settings-input"
            placeholder="模型 ID (例如 gpt-4o)"
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
          />
          <input
            type="text"
            className="native-settings-input"
            placeholder="显示名称 (可选)"
            value={newModelName}
            onChange={(e) => setNewModelName(e.target.value)}
          />
          <label className="native-model-checkbox-label">
            <input
              type="checkbox"
              checked={newModelReasoning}
              onChange={(e) => setNewModelReasoning(e.target.checked)}
            />
            <span>推理</span>
          </label>
          <button
            type="button"
            className="native-btn native-btn-secondary"
            disabled={!newModelId.trim()}
            onClick={handleAddManualModel}
          >
            添加模型
          </button>
        </div>
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

/** 供应商详情区：密钥 + 连接参数（API 地址/协议）+ 模型目录。 */
function ProviderDetail(props: {
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

  const [candidateModels, setCandidateModels] = useState<
    LlmDiscoveredModel[] | null
  >(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manualModelId, setManualModelId] = useState("");
  const [manualModelName, setManualModelName] = useState("");
  const [manualModelReasoning, setManualModelReasoning] = useState(false);

  const effectiveBaseURL =
    draftBaseURL || (stringAt(fallback, "baseURL") ?? "");

  const handleDiscoverInDetail = async () => {
    if (!effectiveBaseURL || !isHttpUrl(effectiveBaseURL)) {
      setFetchError("请先配置有效的 API 地址 (HTTP/HTTPS URL)");
      return;
    }
    setFetchingModels(true);
    setFetchError(null);
    try {
      const discReq: LlmModelDiscoveryRequest = {
        baseURL: effectiveBaseURL.trim(),
        api: effectiveApi,
      };
      if (props.inputValue.trim()) {
        discReq.apiKey = props.inputValue.trim();
      }
      const res = await rpc<LlmDiscoveredModel[]>(Endpoints.llmDiscoverModels, {
        settingsNs: row.settingsNs || "llm-pi-ai",
        request: discReq,
      });
      if (!res || res.length === 0) {
        setFetchError("服务商接口未返回任何候选模型，请手动输入添加");
      } else {
        setCandidateModels(res);
      }
    } catch (err) {
      setFetchError(
        `获取失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFetchingModels(false);
    }
  };

  const handleAddCandidatesInDetail = (chosen: LlmDiscoveredModel[]) => {
    const existing = new Set(declaredModels.map((m) => m.id));
    const toAdd: CustomModelEntry[] = [];
    for (const c of chosen) {
      if (!existing.has(c.id)) {
        toAdd.push({
          id: c.id,
          name: c.name && c.name !== c.id ? c.name : undefined,
        });
      }
    }
    props.onDraftField("models", [...declaredModels, ...toAdd]);
    setCandidateModels(null);
  };

  const handleAddManualInDetail = () => {
    const id = manualModelId.trim();
    if (!id) return;
    if (declaredModels.some((m) => m.id === id)) {
      setFetchError(`模型 ID「${id}」已在列表中`);
      return;
    }
    props.onDraftField("models", [
      ...declaredModels,
      {
        id,
        name: manualModelName.trim() ? manualModelName.trim() : undefined,
        reasoning: manualModelReasoning || undefined,
      },
    ]);
    setManualModelId("");
    setManualModelName("");
    setManualModelReasoning(false);
    setFetchError(null);
  };

  const handleRemoveModelInDetail = (id: string) => {
    props.onDraftField(
      "models",
      declaredModels.filter((m) => m.id !== id),
    );
  };

  return (
    <div className="native-provider-detail">
      {candidateModels && (
        <CandidateModelPicker
          candidates={candidateModels}
          onAdd={handleAddCandidatesInDetail}
          onClose={() => setCandidateModels(null)}
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
          <button
            type="button"
            className="native-provider-visible-toggle"
            onClick={() => props.onToggleVisible(ref)}
            title={props.visible ? "隐藏密钥" : "显示密钥"}
          >
            {props.visible ? (
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
              >
                <path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7.029 7.029 0 0 0 2.79-.588zM5.21 3.088A7.028 7.028 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474L5.21 3.089z" />
                <path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829l-2.83-2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171-5.006a.75.75 0 0 1 1.06 1.06l-12 12a.75.75 0 0 1-1.06-1.06l12-12z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
              >
                <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z" />
                <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z" />
              </svg>
            )}
          </button>
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
            {(row.declared ? declaredModels.length : props.models.length)} 个
          </span>
          {row.declared && (
            <div className="native-model-actions-head">
              <button
                type="button"
                className="native-btn native-btn-secondary native-btn-sm"
                disabled={fetchingModels || props.loading || !effectiveBaseURL}
                onClick={handleDiscoverInDetail}
                title={
                  effectiveBaseURL
                    ? "从服务商接口拉取可用模型"
                    : "请先填写并保存 API 地址"
                }
              >
                {fetchingModels ? "获取中..." : "获取可用模型"}
              </button>
            </div>
          )}
        </div>

        {fetchError && (
          <div className="native-provider-error">{fetchError}</div>
        )}

        {row.declared ? (
          declaredModels.length === 0 ? (
            <div className="native-model-empty">
              未配置模型。请点击「获取可用模型」或在下方手动添加。
            </div>
          ) : (
            declaredModels.map((model) => (
              <div key={model.id} className="native-model-item">
                <div className="native-settings-row-text">
                  <div className="native-model-name">
                    {model.name || model.id}
                    {model.name && model.name !== model.id && (
                      <span className="native-model-id">{model.id}</span>
                    )}
                  </div>
                </div>
                <div className="native-model-item-side">
                  {model.reasoning && (
                    <span className="native-model-tag">推理</span>
                  )}
                  <button
                    type="button"
                    className="native-model-remove-btn"
                    onClick={() => handleRemoveModelInDetail(model.id)}
                    title="移除此模型"
                  >
                    ×
                  </button>
                </div>
              </div>
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
          <div className="native-model-add-row">
            <input
              type="text"
              className="native-settings-input"
              placeholder="模型 ID (例如 gpt-4o)"
              value={manualModelId}
              onChange={(e) => setManualModelId(e.target.value)}
            />
            <input
              type="text"
              className="native-settings-input"
              placeholder="显示名称 (可选)"
              value={manualModelName}
              onChange={(e) => setManualModelName(e.target.value)}
            />
            <label className="native-model-checkbox-label">
              <input
                type="checkbox"
                checked={manualModelReasoning}
                onChange={(e) => setManualModelReasoning(e.target.checked)}
              />
              <span>推理</span>
            </label>
            <button
              type="button"
              className="native-btn native-btn-secondary"
              disabled={!manualModelId.trim()}
              onClick={handleAddManualInDetail}
            >
              添加模型
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPage({
  onBack,
  sidebarPanel,
  modelCatalog,
  onRefreshCatalog,
  dshConnected,
  reconnecting,
  onReconnect,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("models");

  // 1. 青梧应用级设置
  const [appSettings, setAppSettings] = useState<AppSettings>({
    closeToTray: true,
    uiMode: "native",
    collapseProcess: false,
  });

  // 2. 引擎供应商目录、选中路由与凭据输入暂存
  const [providerRows, setProviderRows] = useState<ProviderRow[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  /** 添加流程进行中：详情区展示「可选供应商」选择器或被选中的未配置供应商。 */
  const [addingProvider, setAddingProvider] = useState(false);
  /** 自定义服务商添加进行中。 */
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

  // 3. DSH 默认值 (settings describe)
  const [settingsSnapshot, setSettingsSnapshot] =
    useState<SettingsDescribeValue | null>(null);
  const [defaultPreset, setDefaultPreset] = useState<string>("standard");
  const [defaultModelKey, setDefaultModelKey] = useState<string>("");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

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

  // 清除 / 删除 API Key
  const handleUnsetCredential = async (ref: string) => {
    try {
      setCredLoading(true);
      setCredMessage(null);
      await rpc<void>(Endpoints.credentialsUnset, { ref });
      setKeyInputs((prev) => ({ ...prev, [ref]: "" }));
      setCredMessage(`凭据 ${ref} 已清除`);
      await loadProviders();
      onRefreshCatalog?.();
    } catch (e) {
      setCredMessage(`清除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCredLoading(false);
    }
  };

  // 读取 DSH Settings (命名空间)：权限预设 + 新会话默认模型
  const loadSettings = useCallback(async () => {
    try {
      const res = await rpc<SettingsDescribeValue>(
        Endpoints.settingsDescribe,
        {},
      );
      if (res && Array.isArray(res.namespaces)) {
        setSettingsSnapshot(res);
        const permNs = res.namespaces.find((ns) => ns.ns === "permission");
        if (permNs?.value && typeof permNs.value === "object") {
          const val = permNs.value as { defaultPreset?: string };
          if (val.defaultPreset) setDefaultPreset(val.defaultPreset);
        }
        const admNs = res.namespaces.find(
          (ns) => ns.ns === "agent-default-model",
        );
        if (admNs?.value && typeof admNs.value === "object") {
          const sel = admNs.value as { provider?: string; model?: string };
          if (sel.provider && sel.model) {
            setDefaultModelKey(`${sel.provider}/${sel.model}`);
          }
        }
      }
    } catch (e) {
      console.error("[SettingsPage] 读取 settings 失败", e);
    }
  }, []);

  // 更新默认权限预设
  const handleSaveDefaultPreset = async (preset: string) => {
    try {
      setSettingsMessage(null);
      setDefaultPreset(preset);
      const permNs = settingsSnapshot?.namespaces.find(
        (ns) => ns.ns === "permission",
      );
      const rev = permNs ? permNs.revision : undefined;
      await rpc(Endpoints.settingsUpdate, {
        ns: "permission",
        patch: { defaultPreset: preset },
        expectedRevision: rev,
      });
      setSettingsMessage("默认权限已更新");
      await loadSettings();
    } catch (e) {
      setSettingsMessage(
        `更新失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // 更新新会话默认模型（写入引擎 agent-default-model 命名空间，落盘并在重开后保持）
  const handleSaveDefaultModel = async (key: string) => {
    const sep = key.indexOf("/");
    if (sep <= 0) return;
    const provider = key.slice(0, sep);
    const model = key.slice(sep + 1);
    try {
      setSettingsMessage(null);
      setDefaultModelKey(key);
      const admNs = settingsSnapshot?.namespaces.find(
        (ns) => ns.ns === "agent-default-model",
      );
      await rpc(Endpoints.settingsUpdate, {
        ns: "agent-default-model",
        patch: { provider, model },
        expectedRevision: admNs ? admNs.revision : undefined,
      });
      setSettingsMessage("默认模型已更新");
      await loadSettings();
    } catch (e) {
      setSettingsMessage(
        `更新失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // 打开底层 settings.json
  const handleOpenDshConfig = async () => {
    try {
      await rpc(Endpoints.settingsOpenSettingsDocument, {});
    } catch (e) {
      setSettingsMessage(
        `打开配置文件异常: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // 打开青梧本地数据目录
  const handleOpenAppData = async () => {
    if (window.qingwu?.openUserDataFolder) {
      await window.qingwu.openUserDataFolder();
    }
  };

  // 进入页面时初始化数据
  useEffect(() => {
    void loadAppSettings();
    void loadProviders();
    void loadSettings();
  }, [loadAppSettings, loadProviders, loadSettings]);

  // 按 Esc 键返回应用
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  // 模型与权限整页写入引擎配置目录，展示存储横幅；常规页混合两端设置，不展示
  const showDshBanner = activeTab !== "general";
  // 已添加 = 引擎已注册路由，与聊天框模型选择器同一数据源
  const addedRows = providerRows.filter((row) => row.active);
  // 可选供应商：已检测到密钥的排前面，其余按展示名排序
  const availableRows = providerRows
    .filter((row) => !row.active)
    .sort((a, b) => {
      if (a.credentialConfigured !== b.credentialConfigured) {
        return a.credentialConfigured ? -1 : 1;
      }
      return providerDisplayName(a.provider, a.displayName).localeCompare(
        providerDisplayName(b.provider, b.displayName),
        "zh",
      );
    });
  const selectedRow =
    providerRows.find((row) => row.provider === selectedProvider) ?? null;
  const selectedIsAdded = selectedRow
    ? addedRows.some((row) => row.provider === selectedRow.provider)
    : false;
  const selectedView = selectedRow
    ? llmViews[selectedRow.settingsNs]
    : undefined;

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

  const availableProtocols = useMemo(() => {
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

  const setDraftField = (key: string, value: unknown) => {
    setDraftStore((store) => {
      const draft = { ...store.draft };
      if (typeof value === "string" && value.trim() === "") delete draft[key];
      else if (value === undefined) delete draft[key];
      else draft[key] = value;
      return { ...store, draft };
    });
  };

  // 添加自定义服务商保存
  const handleSaveCustom = async (data: {
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
  };

  // 删除自定义服务商
  const handleDeleteProvider = async (row: ProviderRow) => {
    const confirmed = window.confirm(
      `确定要删除服务商「${row.displayName}」吗？相关配置与凭据将被移除。`,
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
      setCredMessage(`服务商 ${row.displayName} 已删除`);
      await loadProviders();
      onRefreshCatalog?.();
      setSelectedProvider(null);
    } catch (err) {
      setCredMessage(
        `删除失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCredLoading(false);
    }
  };

  // 统一保存：profile 的最小路径操作（settings/mutate）+ 新密钥（credentials/set）一次提交
  const handleSaveProvider = async (row: ProviderRow) => {
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
      setCredMessage(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCredLoading(false);
    }
  };

  return (
    <div className="native-settings-page" aria-label="设置">
      {/* 左侧：返回应用 + 分类导航（复用主界面侧栏框架与同一宽度状态） */}
      <aside
        className="native-sidebar native-settings-rail"
        style={{ width: sidebarPanel.width }}
      >
        <button
          type="button"
          className="native-settings-back-btn"
          onClick={onBack}
          title="返回应用 (Esc)"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M13 8a1 1 0 0 1-1 1H5.414l2.293 2.293a1 1 0 1 1-1.414 1.414l-4-4a1 1 0 0 1 0-1.414l4-4a1 1 0 0 1 1.414 1.414L5.414 7H12a1 1 0 0 1 1 1z" />
          </svg>
          <span>返回应用</span>
        </button>

        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="native-sidebar-section">
            <div className="native-sidebar-section-header">
              <span className="native-sidebar-section-title">
                {group.title}
              </span>
            </div>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`native-session-row native-settings-nav-item ${
                  activeTab === item.key ? "active" : ""
                }`}
                onClick={() => setActiveTab(item.key)}
              >
                <span className="native-settings-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* 侧栏与内容面板之间的拖拽条：与主界面侧栏同一实现 */}
      <div
        className="native-resizer"
        role="separator"
        aria-orientation="vertical"
        title="拖动调节宽度，双击复位"
        onPointerDown={(e) => sidebarPanel.startDrag(e, 1)}
        onDoubleClick={sidebarPanel.reset}
      />

      {/* 右侧：分区内容（复用主界面会话面板外观） */}
      <main className="native-chat native-settings-content">
        {dshConnected === false && (
          <div className="native-connection-banner" role="alert">
            <span className="native-connection-icon">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </span>
            <span className="native-connection-text">
              与 DeepSeek Harness 引擎连接中断，正在尝试重新连接…
            </span>
            <button
              type="button"
              className="native-connection-retry-btn"
              disabled={reconnecting}
              onClick={onReconnect}
            >
              {reconnecting ? "正在重连…" : "立即重试"}
            </button>
          </div>
        )}

        {/* 存储位置透明度横幅：仅覆盖整页写入引擎配置的分区 */}
        {showDshBanner && (
          <div className="native-settings-storage-banner">
            <div className="native-settings-storage-icon">
              <svg
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="currentColor"
              >
                <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm1 12H7V7h2v5zm0-6H7V4h2v2z" />
              </svg>
            </div>
            <div className="native-settings-storage-desc">
              <strong>存储位置：DSH 引擎配置目录 (~/.dsh)</strong>
              <span>
                此分区配置直接写入底层引擎并与 DeepSeek
                界面共享互通，后续官方推出桌面版时可直接继承。
              </span>
            </div>
          </div>
        )}

        {/* 模型设置 */}
        {activeTab === "models" && (
          <div className="native-settings-panel">
            <div className="native-settings-panel-header native-models-header">
              <div>
                <h2>模型设置</h2>
                <p>
                  管理各供应商的 API
                  地址、协议与密钥，配置后即可在对话中选择使用；配置与 DeepSeek
                  界面共享。
                </p>
              </div>
              <div className="native-models-actions">
                <button
                  type="button"
                  className="native-provider-refresh"
                  title="刷新供应商与模型目录"
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
                <button
                  type="button"
                  className="native-btn native-btn-primary"
                  onClick={() => {
                    if (addingProvider || isAddingCustom) {
                      setAddingProvider(false);
                      setIsAddingCustom(false);
                      const firstAdded = addedRows[0]?.provider ?? null;
                      setSelectedProvider(firstAdded);
                    } else {
                      setAddingProvider(true);
                      setIsAddingCustom(false);
                      setSelectedProvider(null);
                    }
                  }}
                >
                  {addingProvider || isAddingCustom ? (
                    "取消添加"
                  ) : (
                    <>
                      <svg
                        viewBox="0 0 16 16"
                        width="14"
                        height="14"
                        fill="currentColor"
                      >
                        <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
                      </svg>
                      添加供应商
                    </>
                  )}
                </button>
              </div>
            </div>

            {credMessage && (
              <div className="native-settings-alert">{credMessage}</div>
            )}

            {settingsMessage && (
              <div className="native-settings-alert">{settingsMessage}</div>
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
                    onClick={() => {
                      setAddingProvider(false);
                      setIsAddingCustom(false);
                      setSelectedProvider(row.provider);
                    }}
                    title={row.displayName}
                  >
                    <span className="native-provider-nav-name">
                      {row.displayName}
                    </span>
                    {row.declared && (
                      <span className="native-provider-badge">自定义</span>
                    )}
                  </button>
                ))}
                {addedRows.length === 0 && (
                  <div className="native-provider-nav-empty">
                    尚未添加供应商
                  </div>
                )}
              </nav>

              {/* 右：详情或「添加供应商」选择器 */}
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
                    modelCatalog?.groups?.find(
                      (g) => g.id === selectedRow.provider,
                    )?.models ?? []
                  }
                  view={selectedView}
                  writable={settingsWritable}
                  draft={draftStore.draft}
                  onDraftField={setDraftField}
                  inputValue={
                    keyInputs[
                      selectedRow.apiKeyEnv ??
                        deriveKeyRef(selectedRow.provider)
                    ] ?? ""
                  }
                  visible={
                    keyVisible[
                      selectedRow.apiKeyEnv ??
                        deriveKeyRef(selectedRow.provider)
                    ] ?? false
                  }
                  loading={credLoading}
                  canSave={
                    profileDirty ||
                    (
                      keyInputs[
                        selectedRow.apiKeyEnv ??
                          deriveKeyRef(selectedRow.provider)
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
                    selectedRow.declared
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
                    title="添加自定义服务商"
                  >
                    <span className="native-provider-card-body">
                      <span className="native-provider-card-name">
                        + 添加自定义服务商
                      </span>
                      <span className="native-provider-picker-hint">
                        支持 OpenAI / Anthropic 兼容端点、自建网关或第三方 API
                      </span>
                    </span>
                  </button>
                  {availableRows.length === 0 ? (
                    <div className="native-model-empty">
                      所有内置服务商都已添加，您可以添加自定义服务商
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
                                已检测到密钥
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

            {/* 新会话默认模型（引擎 agent-default-model 命名空间，与 DeepSeek 界面共享） */}
            {modelOptions.length > 0 && (
              <div className="native-settings-card">
                <SettingsRow
                  label="新会话默认模型"
                  desc="未指定模型的新会话默认使用此模型；选择后写入引擎设置并在重开后保持。"
                >
                  <select
                    className="native-settings-select"
                    value={defaultModelKey}
                    onChange={(e) =>
                      void handleSaveDefaultModel(e.target.value)
                    }
                  >
                    <option value="">跟随引擎默认推选</option>
                    {modelOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
              </div>
            )}
          </div>
        )}

        {/* 常规 */}
        {activeTab === "general" && (
          <div className="native-settings-panel">
            <div className="native-settings-panel-header">
              <h2>常规</h2>
              <p>界面、窗口与配置文件入口等基础选项。</p>
            </div>

            <div className="native-settings-card">
              <SettingsRow
                label="界面语言"
                desc="当前桌面客户端与底层引擎的界面语言。"
              >
                <select
                  className="native-settings-select"
                  defaultValue="zh"
                  disabled
                >
                  <option value="zh">简体中文</option>
                  <option value="en">English (跟随系统)</option>
                </select>
              </SettingsRow>

              <SettingsRow label="默认界面" desc="启动青梧时默认展示的界面。">
                <select
                  className="native-settings-select"
                  value={appSettings.uiMode}
                  onChange={(e) =>
                    void handleUpdateAppSetting({
                      uiMode: e.target.value as AppSettings["uiMode"],
                    })
                  }
                >
                  <option value="native">青梧界面</option>
                  <option value="official">DeepSeek 界面</option>
                </select>
              </SettingsRow>

              <SettingsRow
                label="最小化到系统托盘"
                desc="关闭窗口后应用常驻系统托盘，后台会话不中断；关闭后点击关闭按钮将直接退出青梧。"
              >
                <SettingsSwitch
                  checked={appSettings.closeToTray}
                  onChange={(next) =>
                    void handleUpdateAppSetting({ closeToTray: next })
                  }
                  label="最小化到系统托盘"
                />
              </SettingsRow>

              <SettingsRow
                label="折叠执行过程与工具调用"
                desc="对话回合完成后，将思考过程与工具调用收起为单行摘要；默认关闭，平铺展开与 DeepSeek 界面保持一致。"
              >
                <SettingsSwitch
                  checked={Boolean(appSettings.collapseProcess)}
                  onChange={(next) =>
                    void handleUpdateAppSetting({ collapseProcess: next })
                  }
                  label="折叠执行过程与工具调用"
                />
              </SettingsRow>

              <SettingsRow
                label="青梧应用数据目录"
                desc="存放桌面窗口状态、应用配置与运行日志的本地目录 (%APPDATA%/qingwu)。"
              >
                <button
                  type="button"
                  className="native-btn native-btn-secondary"
                  onClick={handleOpenAppData}
                >
                  在文件管理器中打开
                </button>
              </SettingsRow>

              <SettingsRow
                label="底层引擎配置文件"
                desc="DSH 引擎的全局配置文件 (~/.dsh/settings.json)，包含所有已注册的扩展参数。"
              >
                <button
                  type="button"
                  className="native-btn native-btn-secondary"
                  onClick={handleOpenDshConfig}
                >
                  在编辑器中打开
                </button>
              </SettingsRow>
            </div>
          </div>
        )}

        {/* 权限 */}
        {activeTab === "permissions" && (
          <div className="native-settings-panel">
            <div className="native-settings-panel-header">
              <h2>权限</h2>
              <p>配置写入引擎配置目录，与 DeepSeek 界面共享。</p>
            </div>

            {settingsMessage && (
              <div className="native-settings-alert">{settingsMessage}</div>
            )}

            <div className="native-settings-card">
              <SettingsRow
                label="新会话执行权限"
                desc="决定新建会话在执行命令与修改文件时的审批策略。"
              >
                <select
                  className="native-settings-select"
                  value={defaultPreset}
                  onChange={(e) => void handleSaveDefaultPreset(e.target.value)}
                >
                  <option value="standard">标准询问</option>
                  <option value="elevated">完全授权</option>
                  <option value="restricted">安全只读</option>
                </select>
              </SettingsRow>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
