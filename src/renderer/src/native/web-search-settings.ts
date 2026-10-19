import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOp } from "./protocol";

export type DeepSeekSearchMode = "api" | "messages";
export type SearchMode = DeepSeekSearchMode | "external";
export type SearchKeySource = "model" | "independent";
export interface SearchDraft {
  baseURL: string;
  limit: string;
  keySource: SearchKeySource;
  apiKeyDraft: string;
}
/** 仅映射 dsh 的提供方和字段，不实现搜索、凭据或配置持久化。 */
export const SEARCH_MODES = {
  api: {
    ns: "web-deepseek-api", search: "deepseek-search-api", fetch: "deepseek-fetch-api",
    baseURL: "https://api.deepseek.com/v1/tools", limit: "count", defaultLimit: 10,
    independentRef: "QINGWU_DEEPSEEK_SEARCH_API_KEY",
  },
  messages: {
    ns: "web-search-deepseek", search: "deepseek-official", fetch: "http",
    baseURL: "https://api.deepseek.com/anthropic/v1", limit: "maxUses", defaultLimit: 5,
    independentRef: "QINGWU_DEEPSEEK_MESSAGES_SEARCH_API_KEY",
  },
} as const;
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
  for (const mode of ["api", "messages"] as const) {
    if (web.searchProvider === SEARCH_MODES[mode].search && web.fetchProvider === SEARCH_MODES[mode].fetch) return mode;
  }
  return "external";
}
export function draftFrom(snapshot: SettingsDescribeValue, mode: DeepSeekSearchMode): SearchDraft {
  const config = SEARCH_MODES[mode];
  const ns = namespace(snapshot, config.ns);
  const value = section(ns);
  return {
    baseURL: typeof value.baseURL === "string" ? value.baseURL : "",
    limit: String(value[config.limit] ?? config.defaultLimit),
    keySource: hasLiteralKey(ns) || searchKeyRef(ns) !== modelKeyRef(snapshot) ? "independent" : "model",
    apiKeyDraft: "",
  };
}
export function targetKeyRef(snapshot: SettingsDescribeValue, mode: DeepSeekSearchMode, source: SearchKeySource): string {
  const shared = modelKeyRef(snapshot);
  if (source === "model") return shared;
  const current = searchKeyRef(namespace(snapshot, SEARCH_MODES[mode].ns));
  return current !== shared ? current : SEARCH_MODES[mode].independentRef;
}
/** 刷新只更新未编辑字段，保留草稿。 */
export function rebaseDraft(draft: SearchDraft, before: SearchDraft, after: SearchDraft): SearchDraft {
  return {
    baseURL: draft.baseURL === before.baseURL ? after.baseURL : draft.baseURL,
    limit: draft.limit === before.limit ? after.limit : draft.limit,
    keySource: draft.keySource === before.keySource ? after.keySource : draft.keySource,
    apiKeyDraft: draft.apiKeyDraft,
  };
}
export function validateDraft(mode: DeepSeekSearchMode, draft: SearchDraft): "invalidBaseURL" | "invalidLimit" | null {
  if (draft.baseURL.trim()) {
    try {
      const url = new URL(draft.baseURL.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return "invalidBaseURL";
    } catch { return "invalidBaseURL"; }
  }
  if (draft.limit.trim()) {
    const n = Number(draft.limit);
    if (!Number.isSafeInteger(n) || n < 1 || (mode === "api" && n > 50)) return "invalidLimit";
  }
  return null;
}
export function configOps(snapshot: SettingsDescribeValue, mode: DeepSeekSearchMode, draft: SearchDraft): SettingsPathOp[] {
  const config = SEARCH_MODES[mode];
  const baseline = draftFrom(snapshot, mode);
  const ns = namespace(snapshot, config.ns);
  const ops: SettingsPathOp[] = [];
  for (const [field, current, original] of [
    ["baseURL", draft.baseURL, baseline.baseURL], [config.limit, draft.limit, baseline.limit],
  ]) {
    if (current.trim() === original.trim()) continue;
    ops.push(current.trim()
      ? { op: "set", path: [field], value: field === "baseURL" ? current.trim() : Number(current) }
      : { op: "unset", path: [field] });
  }
  if (draft.keySource !== baseline.keySource || (draft.keySource === "independent" && draft.apiKeyDraft.trim())) {
    const ref = targetKeyRef(snapshot, mode, draft.keySource);
    if (searchKeyRef(ns) !== ref) ops.push({ op: "set", path: ["apiKeyEnv"], value: ref });
    // 字面密钥优先于引用。空覆盖停止它，不读取或回传任何明文。
    if (hasLiteralKey(ns)) ops.push({ op: "set", path: ["apiKey"], value: "" });
  }
  return ops;
}
export function selectionOps(snapshot: SettingsDescribeValue, mode: DeepSeekSearchMode): SettingsPathOp[] {
  if (mode === selectedMode(snapshot)) return [];
  const base = (namespace(snapshot, "web")?.base ?? {}) as Record<string, unknown>;
  return (["searchProvider", "fetchProvider"] as const).map((field) => {
    const value = field === "searchProvider" ? SEARCH_MODES[mode].search : SEARCH_MODES[mode].fetch;
    return base[field] === value ? { op: "unset", path: [field] } : { op: "set", path: [field], value };
  });
}
