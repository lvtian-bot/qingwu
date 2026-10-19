import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { Endpoints, type CredentialInfo, type SettingsDescribeValue } from "./protocol";
import { rpc } from "./rpc";

export const DEFAULT_SEARCH_API_BASE_URL = "https://api.deepseek.com/v1/tools";
export const DEFAULT_SEARCH_COUNT = 8;

export interface WebSearchSettingsOptions {
  /** 当凭据（API Key）更新保存后触发，用于联动刷新模型设置等其他分区的凭据状态 */
  onRefreshCredentials?: () => void;
}

export interface WebSearchSettingsController {
  /** 搜索服务商模式：deepseek（官方高速）或 custom（自定义代理） */
  providerType: "deepseek" | "custom";
  setProviderType: (type: "deepseek" | "custom") => void;
  /** 自定义 Search / Fetch 接口基础地址草稿 */
  baseURL: string;
  setBaseURL: (url: string) => void;
  /** 每次搜索条数（1-50） */
  count: number;
  setCount: (count: number) => void;
  /** 系统中是否已配置有效的 API Key */
  hasKey: boolean;
  /** 专用 API Key 是否可写（由环境变量提供或状态未知时为 false） */
  keyWritable: boolean;
  /** 凭据状态是否已成功获知（若查询失败则为 false，禁用编辑） */
  keyStatusKnown: boolean;
  /** 专用 API Key 输入草稿 */
  apiKeyDraft: string;
  setApiKeyDraft: (key: string) => void;
  /** 配置是否已成功加载完成 */
  loaded: boolean;
  /** 当前引擎设置是否具备写入能力（只读模式下为 false） */
  writable: boolean;
  /** 是否正在保存 */
  saving: boolean;
  /** 操作成功反馈 */
  message: string | null;
  /** 操作错误提示 */
  error: string | null;
  /** 提交保存所有修改 */
  save: () => Promise<void>;
  /** 重新加载当前配置 */
  refresh: () => Promise<void>;
}

interface SavedBaseline {
  providerType: "deepseek" | "custom";
  baseURL: string;
  count: number;
  searchProvider: string;
  fetchProvider: string;
}

export function useWebSearchSettings(
  options?: WebSearchSettingsOptions,
): WebSearchSettingsController {
  const t = useT();
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsDescribeValue | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [writable, setWritable] = useState<boolean>(true);
  const [keyWritable, setKeyWritable] = useState<boolean>(true);
  const [keyStatusKnown, setKeyStatusKnown] = useState<boolean>(true);
  const [keyRef, setKeyRef] = useState<string>("DEEPSEEK_API_KEY");

  // 表单编辑字段状态
  const [providerType, setProviderType] = useState<"deepseek" | "custom">("deepseek");
  const [baseURL, setBaseURL] = useState<string>("");
  const [count, setCount] = useState<number>(DEFAULT_SEARCH_COUNT);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [apiKeyDraft, setApiKeyDraft] = useState<string>("");

  // 加载基线：用于保存时纯粹的差分比对（Diff），防止固化未修改的继承项
  const [baseline, setBaseline] = useState<SavedBaseline>({
    providerType: "deepseek",
    baseURL: "",
    count: DEFAULT_SEARCH_COUNT,
    searchProvider: "deepseek-search-api",
    fetchProvider: "deepseek-fetch-api",
  });

  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const settingsRes = await rpc<SettingsDescribeValue>(
        Endpoints.settingsDescribe,
        {},
      ).catch((e) => {
        console.warn("[WebSearchSettings] 读取 settingsDescribe 失败:", e);
        return null;
      });

      let activeKeyRef = "DEEPSEEK_API_KEY";

      if (settingsRes && Array.isArray(settingsRes.namespaces)) {
        setSettingsSnapshot(settingsRes);
        setLoaded(true);
        setWritable(settingsRes.writable !== false);
        setError(null);

        const webNs = settingsRes.namespaces.find((ns) => ns.ns === "web");
        const webVal = webNs?.value as { searchProvider?: string; fetchProvider?: string } | undefined;
        const searchProvider = webVal?.searchProvider ?? "deepseek-search-api";
        const fetchProvider = webVal?.fetchProvider ?? "deepseek-fetch-api";

        const apiNs = settingsRes.namespaces.find((ns) => ns.ns === "web-deepseek-api");
        const apiVal = apiNs?.value as {
          baseURL?: string;
          count?: number;
          apiKeyEnv?: string;
        } | undefined;

        if (typeof apiVal?.apiKeyEnv === "string" && apiVal.apiKeyEnv.trim() !== "") {
          activeKeyRef = apiVal.apiKeyEnv.trim();
        }
        setKeyRef(activeKeyRef);

        const currentBaseURL = typeof apiVal?.baseURL === "string" ? apiVal.baseURL : "";
        setBaseURL(currentBaseURL);

        const currentCount =
          typeof apiVal?.count === "number"
            ? Math.min(8, Math.max(1, apiVal.count))
            : DEFAULT_SEARCH_COUNT;
        setCount(currentCount);

        const isOfficialProviders =
          searchProvider === "deepseek-search-api" &&
          fetchProvider === "deepseek-fetch-api";
        const isOfficialBaseURL =
          !currentBaseURL || currentBaseURL === DEFAULT_SEARCH_API_BASE_URL;

        const resolvedType = !isOfficialProviders || !isOfficialBaseURL ? "custom" : "deepseek";
        setProviderType(resolvedType);

        setBaseline({
          providerType: resolvedType,
          baseURL: currentBaseURL,
          count: currentCount,
          searchProvider,
          fetchProvider,
        });
      } else {
        setLoaded(false);
        setError(t("settings.webSearch.loadFailed"));
      }

      // 按照当前插件生效的凭据引用查询密钥状态
      const credsRes = await rpc<Record<string, CredentialInfo>>(
        Endpoints.credentialsDescribe,
        { refs: [activeKeyRef] },
      ).catch((e) => {
        console.warn("[WebSearchSettings] 读取 credentialsDescribe 失败:", e);
        return null;
      });

      if (credsRes && typeof credsRes === "object") {
        const targetCred = credsRes[activeKeyRef];
        setHasKey(Boolean(targetCred?.configured));
        setKeyWritable(targetCred?.writable !== false);
        setKeyStatusKnown(true);
      } else {
        setHasKey(false);
        setKeyWritable(false);
        setKeyStatusKnown(false);
      }
    } catch (err) {
      setLoaded(false);
      setError(t("settings.webSearch.loadFailed"));
      console.error("[WebSearchSettings] 加载配置异常:", err);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    const hasKeyChange = Boolean(keyWritable && apiKeyDraft.trim());
    if (!settingsSnapshot) {
      setError(t("settings.webSearch.loadFailed"));
      return;
    }
    if (!writable && !hasKeyChange) {
      setError(t("settings.webSearch.readOnly"));
      return;
    }

    const normalizedBaseURL = baseURL.trim();
    // 校验自定义端点 URL 合法性
    if (providerType === "custom" && normalizedBaseURL) {
      try {
        const parsed = new URL(normalizedBaseURL);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("Invalid protocol");
        }
      } catch {
        setError(t("settings.webSearch.invalidBaseURL"));
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      // 1. 凭据差分：仅当密钥可写且输入了新 Key 时写入
      if (hasKeyChange) {
        await rpc(Endpoints.credentialsSet, {
          ref: keyRef,
          value: apiKeyDraft.trim(),
        });

        // 遵循 DSH 官方契约回读核验凭据：确认凭据被底层提供商真正持久化落盘
        const verifyRes = await rpc<Record<string, CredentialInfo>>(
          Endpoints.credentialsDescribe,
          { refs: [keyRef] },
        ).catch(() => null);
        const verifiedCred = verifyRes?.[keyRef];
        if (!verifiedCred?.configured) {
          throw new Error("Credential write failed verification: key not retained by provider");
        }

        setApiKeyDraft("");
        setHasKey(true);
        // 回读核验通过后立即通知外部凭据消费者（即使后续设置项报错，凭据已生效也需同步更新）
        options?.onRefreshCredentials?.();
      }

      // 2. 设置项差分：仅在设置允许写入时提交服务商与端点配置
      if (writable) {
        // 2.1 服务商差分：仅在服务商模式真正改变时提交更新
        if (providerType !== baseline.providerType) {
          const targetSearchProvider =
            providerType === "deepseek"
              ? "deepseek-search-api"
              : baseline.searchProvider || "deepseek-search-api";
          const targetFetchProvider =
            providerType === "deepseek"
              ? "deepseek-fetch-api"
              : baseline.fetchProvider || "deepseek-fetch-api";

          const webNs = settingsSnapshot.namespaces.find((ns) => ns.ns === "web");
          await rpc(Endpoints.settingsUpdate, {
            ns: "web",
            patch: {
              searchProvider: targetSearchProvider,
              fetchProvider: targetFetchProvider,
            },
            expectedRevision: webNs?.revision,
          });
        }

        // 2.2 API 命名空间差分比对：原子提交修改项
        const apiNs = settingsSnapshot.namespaces.find((ns) => ns.ns === "web-deepseek-api");
        const apiVal = apiNs?.value as { baseURL?: string } | undefined;
        const effectiveBaseURL = typeof apiVal?.baseURL === "string" ? apiVal.baseURL : "";
        const userSection = apiNs?.user as Record<string, unknown> | undefined;
        const hasBaseURLInUserLayer = Boolean(userSection && "baseURL" in userSection);

        const ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }> = [];

        // 条数差分：仅当用户改动了 count 时才提交（上限与 DSH 工具硬限制 8 严格对齐）
        const normalizedCount = Math.min(8, Math.max(1, count));
        if (normalizedCount !== baseline.count) {
          ops.push({ op: "set", path: ["count"], value: normalizedCount });
        }

        // 端点差分：
        if (providerType === "custom") {
          if (normalizedBaseURL) {
            // 自定义模式填入端点：变动时 set
            if (normalizedBaseURL !== baseline.baseURL) {
              ops.push({ op: "set", path: ["baseURL"], value: normalizedBaseURL });
            }
          } else if (hasBaseURLInUserLayer) {
            // 用户清空自定义端点且原端点在用户层：移除用户层覆盖以恢复底层继承
            ops.push({ op: "unset", path: ["baseURL"] });
          } else if (baseline.baseURL && baseline.baseURL !== "") {
            // 用户清空端点但原端点来自底层继承层（用户层无覆盖）：显式覆写为官方默认端点，确保留空恢复默认生效
            ops.push({ op: "set", path: ["baseURL"], value: DEFAULT_SEARCH_API_BASE_URL });
          }
        } else if (providerType === "deepseek") {
          // 官方模式：端点留空即代表官方默认，严禁在无意修改时把官方端点固化写入用户层
          if (hasBaseURLInUserLayer) {
            // 用户层曾有覆盖：在官方模式下一律 unset 移除覆盖，恢复原生继承
            ops.push({ op: "unset", path: ["baseURL"] });
          } else if (effectiveBaseURL && effectiveBaseURL !== DEFAULT_SEARCH_API_BASE_URL) {
            // 来自底层继承的自定义端点（用户层无覆盖）：必须显式覆写为官方默认端点，以覆盖继承的非官方端点
            ops.push({
              op: "set",
              path: ["baseURL"],
              value: DEFAULT_SEARCH_API_BASE_URL,
            });
          }
        }

        if (ops.length > 0) {
          await rpc(Endpoints.settingsMutate, {
            ns: "web-deepseek-api",
            ops,
            expectedRevision: apiNs?.revision,
          });
        }
      }

      setMessage(t("settings.webSearch.savedSuccess"));
      await load();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const formattedError = t("settings.webSearch.savedFailed", { message: errMsg });
      setError(formattedError);
      console.error("[WebSearchSettings] 保存配置失败:", err);
      // 局部失败后重新同步远端快照，防范 revision 错位阻塞重试
      await load().catch(() => {});
      // 恢复被 load() 重置的保存失败提示，保留失败原因供用户查看
      setError(formattedError);
    } finally {
      setSaving(false);
    }
  }, [
    apiKeyDraft,
    baseURL,
    baseline,
    count,
    keyRef,
    keyWritable,
    load,
    options,
    providerType,
    settingsSnapshot,
    t,
    writable,
  ]);

  return {
    providerType,
    setProviderType,
    baseURL,
    setBaseURL,
    count,
    setCount,
    hasKey,
    apiKeyDraft,
    setApiKeyDraft,
    loaded,
    writable,
    keyWritable,
    keyStatusKnown,
    saving,
    message,
    error,
    save,
    refresh: load,
  };
}
