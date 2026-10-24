import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOp } from "./protocol";

export type SearchService = "api" | "exa";
export type SearchMode = SearchService | "external";
export type SearchKeySource = "model" | "independent";
export interface SearchDraft {
  limit: string;
  keySource: SearchKeySource;
  apiKeyDraft: string;
}
/** 仅映射 dsh 的提供方和字段，不实现搜索、凭据或配置持久化。 */
export const SEARCH_SERVICES = {
  api: {
    ns: "web-deepseek-api", search: "deepseek-search-api", fetch: "deepseek-fetch-api",
    limitField: "count", defaultLimit: 10, maxLimit: 50,
    keySourceSelectable: true,
    independentRef: "QINGWU_DEEPSEEK_SEARCH_API_KEY",
  },
  exa: {
    ns: "web-search-exa", search: "exa", fetch: "http",
    limitField: "numResults", defaultLimit: 10, maxLimit: 50,
    keySourceSelectable: false,
    keyRef: "EXA_API_KEY",
  },
} as const;
export const SEARCH_SERVICES_LIST = ["api", "exa"] as const;
/** 已下线的旧版搜索提供方 id；检测到存量选择时由设置页自动迁移到新版。 */
export const LEGACY_SEARCH_PROVIDER = "deepseek-official";
export function section(ns?: SettingsNamespaceView): Record<string, unknown> {
  return (ns?.value ?? {}) as Record<string, unknown>;
}
export function namespace(snapshot: SettingsDescribeValue | null, name: string) {
  return snapshot?.namespaces.find((ns) => ns.ns === name);
}
export function modelKeyRef(snapshot: SettingsDescribeValue | null): string {
  const declared = section(namespace(snapshot, "llm-deepseek")).apiKeyEnv;
  return typeof declared === "string" && declared.trim() ? declared.trim() : "DEEPSEEK_API_KEY";
}
export function searchKeyRef(ns: SettingsNamespaceView | undefined): string {
  const declared = section(ns).apiKeyEnv;
  return typeof declared === "string" && declared.trim() ? declared.trim() : "DEEPSEEK_API_KEY";
}
export function hasLiteralKey(ns?: SettingsNamespaceView): boolean {
  return Boolean(ns?.secrets?.some((secret) => secret.set && secret.path.join(".") === "apiKey"));
}
export function selectedMode(snapshot: SettingsDescribeValue): SearchMode {
  const web = section(namespace(snapshot, "web"));
  for (const service of SEARCH_SERVICES_LIST) {
    const config = SEARCH_SERVICES[service];
    if (web.searchProvider === config.search && web.fetchProvider === config.fetch) return service;
  }
  return "external";
}
export function draftFrom(snapshot: SettingsDescribeValue, service: SearchService): SearchDraft {
  const config = SEARCH_SERVICES[service];
  const ns = namespace(snapshot, config.ns);
  const value = section(ns);
  const independent = config.keySourceSelectable
    ? hasLiteralKey(ns) || searchKeyRef(ns) !== modelKeyRef(snapshot)
    : true;
  return {
    limit: String(value[config.limitField] ?? config.defaultLimit),
    keySource: independent ? "independent" : "model",
    apiKeyDraft: "",
  };
}
export function targetKeyRef(snapshot: SettingsDescribeValue | null, service: SearchService, source: SearchKeySource): string {
  const config = SEARCH_SERVICES[service];
  if ("keyRef" in config) return config.keyRef;
  if (source === "model") return modelKeyRef(snapshot);
  const shared = modelKeyRef(snapshot);
  const current = searchKeyRef(namespace(snapshot, config.ns));
  if (current !== shared) return current;
  const independent = config.independentRef;
  return independent !== shared ? independent : `${independent}_INDEPENDENT`;
}
/** 刷新只更新未编辑字段，保留草稿。 */
export function rebaseDraft(draft: SearchDraft, before: SearchDraft, after: SearchDraft): SearchDraft {
  return {
    limit: draft.limit === before.limit ? after.limit : draft.limit,
    keySource: draft.keySource === before.keySource ? after.keySource : draft.keySource,
    apiKeyDraft: draft.apiKeyDraft,
  };
}
export function validateDraft(service: SearchService, draft: SearchDraft): "invalidLimit" | null {
  if (draft.limit.trim()) {
    const n = Number(draft.limit);
    if (!Number.isSafeInteger(n) || n < 1 || n > SEARCH_SERVICES[service].maxLimit) return "invalidLimit";
  }
  return null;
}
export function configOps(
  snapshot: SettingsDescribeValue, service: SearchService, draft: SearchDraft, reload = false,
): SettingsPathOp[] {
  const config = SEARCH_SERVICES[service];
  const baseline = draftFrom(snapshot, service);
  const keyChange = draft.keySource === "independent" && Boolean(draft.apiKeyDraft.trim());
  const limitChanged = draft.limit.trim() !== baseline.limit.trim();
  const ops: SettingsPathOp[] = [];
  if (limitChanged || (reload && keyChange && service === "exa")) {
    // Exa 插件在构造时快照启动环境里的 EXA_API_KEY；凭据更新后必须写入
    // 一次插件配置触发重建，新密钥才会被读取。numResults 是唯一安全的触发字段。
    const value = draft.limit.trim() || (limitChanged ? "" : String(baseline.limit || config.defaultLimit));
    ops.push(value
      ? { op: "set", path: [config.limitField], value: Number(value) }
      : { op: "unset", path: [config.limitField] });
  }
  if (config.keySourceSelectable) {
    if (draft.keySource !== baseline.keySource || (draft.keySource === "independent" && keyChange)) {
      const ref = targetKeyRef(snapshot, service, draft.keySource);
      const ns = namespace(snapshot, config.ns);
      if (searchKeyRef(ns) !== ref) ops.push({ op: "set", path: ["apiKeyEnv"], value: ref });
      // 字面密钥优先于引用。空覆盖停止它，不读取或回传任何明文。
      if (hasLiteralKey(ns)) ops.push({ op: "set", path: ["apiKey"], value: "" });
    }
  }
  return ops;
}
export function selectionOps(snapshot: SettingsDescribeValue, service: SearchService): SettingsPathOp[] {
  if (selectedMode(snapshot) === service) return [];
  const config = SEARCH_SERVICES[service];
  const base = (namespace(snapshot, "web")?.base ?? {}) as Record<string, unknown>;
  return (["searchProvider", "fetchProvider"] as const).map((field) => {
    const value = field === "searchProvider" ? config.search : config.fetch;
    return base[field] === value ? { op: "unset", path: [field] } : { op: "set", path: [field], value };
  });
}
