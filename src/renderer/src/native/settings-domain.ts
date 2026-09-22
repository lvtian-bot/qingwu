import {
  type ConfigurableProviderEntry,
  type LlmDiscoveredModel,
  type RegisteredProvider,
  type SettingsNamespaceView,
  type SettingsPathOp,
} from "./protocol";
import { providerDisplayName } from "./provider-brand";

/** 供应商目录行：官方 settings-models 的 joinProviderDirectory 语义移植。 */
export interface ProviderRow {
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

/** 自定义服务商与自声明路由的模型清单条目。 */
export interface CustomModelEntry {
  id: string;
  name?: string;
  reasoning?: boolean;
}

export const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** 派生供应商路由的常规凭据引用（与官方 deriveKeyRef 一致，如 minimax-cn → MINIMAX_CN_API_KEY）。 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/** 声明目录与已注册路由 join：声明行在前，未声明的存活路由补在后。 */
export function joinProviderDirectory(
  registered: RegisteredProvider[],
  directory: ConfigurableProviderEntry[],
): ProviderRow[] {
  const active = new Set(registered.map((p) => p.id));
  const declared = new Set(directory.map((e) => e.provider));
  const rows: ProviderRow[] = directory.map((entry) => ({
    provider: entry.provider,
    displayName: providerDisplayName(entry.provider, entry.displayName),
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
      displayName: providerDisplayName(provider.id, provider.name),
      settingsNs: "",
      settingsPath: [],
      active: true,
    });
  }
  return rows;
}

/** 沿路径读取设置值内的嵌套对象（空路径返回原值）。 */
export function valueAtPath(value: unknown, path: string[]): unknown {
  let node = value;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** 对象字段里的非空字符串（空串视同未设置，与官方 stringAt 一致）。 */
export function stringAt(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

/** 供应商所属适配器家族：决定详情区可编辑字段与占位文案。 */
export function familyOf(settingsNs: string): "deepseek" | "pi-ai" | "unknown" {
  if (settingsNs === "llm-deepseek") return "deepseek";
  if (settingsNs === "llm-pi-ai") return "pi-ai";
  return "unknown";
}

/** 命名空间用户段在路径上的子树副本（无覆盖时为空对象）；编辑草稿取自这里。 */
export function userSubtreeAt(
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
export function pathOps(
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
export function schemaUnionChoices(schema: unknown, path: string[]): string[] {
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

export function formatRelativeTime(at: number, now = Date.now()): string {
  if (!at || isNaN(at)) return "刚刚";
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const diff = Math.max(0, now - at);
  if (diff < MIN) return "刚刚";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))} 个月前`;
  return `${Math.floor(diff / (365 * DAY))} 年前`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** 接口拉取的候选并入现有模型清单（按 ID 去重，返回合并后的完整清单）。 */
export function mergeCandidateModels(
  existing: CustomModelEntry[],
  chosen: LlmDiscoveredModel[],
): CustomModelEntry[] {
  const merged = [...existing];
  const ids = new Set(existing.map((m) => m.id));
  for (const c of chosen) {
    if (ids.has(c.id)) continue;
    ids.add(c.id);
    merged.push({
      id: c.id,
      name: c.name && c.name !== c.id ? c.name : undefined,
    });
  }
  return merged;
}

/** 手动添加模型到清单；ID 重复时返回错误文案。入参应为已去除首尾空白的值。 */
export function appendManualModel(
  existing: CustomModelEntry[],
  id: string,
  name: string,
  reasoning: boolean,
): { ok: true; models: CustomModelEntry[] } | { ok: false; error: string } {
  if (existing.some((m) => m.id === id)) {
    return { ok: false, error: `模型 ID「${id}」已在列表中` };
  }
  return {
    ok: true,
    models: [
      ...existing,
      {
        id,
        name: name || undefined,
        reasoning: reasoning || undefined,
      },
    ],
  };
}
