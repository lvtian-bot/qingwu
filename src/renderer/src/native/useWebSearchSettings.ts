import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { Endpoints, type CredentialInfo, type SettingsDescribeValue } from "./protocol";
import { rpc } from "./rpc";

export const DEFAULT_SEARCH_API_BASE_URL = "https://api.deepseek.com/v1/tools";
export const DEFAULT_SEARCH_COUNT = 10;

export interface WebSearchSettingsController {
  /** 搜索服务商模式：deepseek（官方高速）或 custom（自定义） */
  providerType: "deepseek" | "custom";
  setProviderType: (type: "deepseek" | "custom") => void;
  /** 自定义 Search / Fetch 接口基础地址草稿 */
  baseURL: string;
  setBaseURL: (url: string) => void;
  /** 每次搜索条数（1-50） */
  count: number;
  setCount: (count: number) => void;
  /** 系统中是否已配置 DeepSeek API Key */
  hasKey: boolean;
  /** 专用 API Key 输入草稿 */
  apiKeyDraft: string;
  setApiKeyDraft: (key: string) => void;
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

export function useWebSearchSettings(): WebSearchSettingsController {
  const t = useT();
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsDescribeValue | null>(null);
  const [providerType, setProviderType] = useState<"deepseek" | "custom">("deepseek");
  const [baseURL, setBaseURL] = useState<string>("");
  const [count, setCount] = useState<number>(DEFAULT_SEARCH_COUNT);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [apiKeyDraft, setApiKeyDraft] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [settingsRes, credsRes] = await Promise.all([
        rpc<SettingsDescribeValue>(Endpoints.settingsDescribe, {}).catch((e) => {
          console.warn("[WebSearchSettings] 读取 settingsDescribe 失败:", e);
          return null;
        }),
        rpc<Record<string, CredentialInfo>>(Endpoints.credentialsDescribe, {
          refs: ["DEEPSEEK_API_KEY"],
        }).catch((e) => {
          console.warn("[WebSearchSettings] 读取 credentialsDescribe 失败:", e);
          return null;
        }),
      ]);

      if (settingsRes && Array.isArray(settingsRes.namespaces)) {
        setSettingsSnapshot(settingsRes);

        const webNs = settingsRes.namespaces.find((ns) => ns.ns === "web");
        const webVal = webNs?.value as { searchProvider?: string; fetchProvider?: string } | undefined;
        const searchProvider = webVal?.searchProvider ?? "deepseek-search-api";

        const apiNs = settingsRes.namespaces.find((ns) => ns.ns === "web-deepseek-api");
        const apiVal = apiNs?.value as { baseURL?: string; count?: number } | undefined;

        const currentBaseURL = typeof apiVal?.baseURL === "string" ? apiVal.baseURL : "";
        setBaseURL(currentBaseURL);

        const currentCount = typeof apiVal?.count === "number" ? apiVal.count : DEFAULT_SEARCH_COUNT;
        setCount(currentCount);

        // 如果配置了非默认的 searchProvider 或者自定义了端点，则识别为自定义模式
        if (
          searchProvider !== "deepseek-search-api" ||
          (currentBaseURL && currentBaseURL !== DEFAULT_SEARCH_API_BASE_URL)
        ) {
          setProviderType("custom");
        } else {
          setProviderType("deepseek");
        }
      }

      if (credsRes && typeof credsRes === "object") {
        const deepseekCred = credsRes["DEEPSEEK_API_KEY"];
        setHasKey(Boolean(deepseekCred?.configured));
      }
    } catch (err) {
      console.error("[WebSearchSettings] 加载配置异常:", err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      // 1. 保存凭据（若用户输入了新 Key）
      if (apiKeyDraft.trim()) {
        await rpc(Endpoints.credentialsSet, {
          ref: "DEEPSEEK_API_KEY",
          value: apiKeyDraft.trim(),
        });
        setApiKeyDraft("");
        setHasKey(true);
      }

      // 2. 保存 web 命名空间
      const webNs = settingsSnapshot?.namespaces.find((ns) => ns.ns === "web");
      await rpc(Endpoints.settingsUpdate, {
        ns: "web",
        patch: {
          searchProvider: "deepseek-search-api",
          fetchProvider: "deepseek-fetch-api",
        },
        expectedRevision: webNs?.revision,
      });

      // 3. 保存 web-deepseek-api 命名空间
      const apiNs = settingsSnapshot?.namespaces.find((ns) => ns.ns === "web-deepseek-api");
      const normalizedCount = Math.min(50, Math.max(1, count));
      const normalizedBaseURL = baseURL.trim();

      const apiPatch: Record<string, unknown> = {
        count: normalizedCount,
      };

      if (providerType === "custom" && normalizedBaseURL) {
        apiPatch.baseURL = normalizedBaseURL;
      } else {
        // 恢复默认基础地址
        apiPatch.baseURL = null;
      }

      await rpc(Endpoints.settingsUpdate, {
        ns: "web-deepseek-api",
        patch: apiPatch,
        expectedRevision: apiNs?.revision,
      });

      setMessage(t("settings.webSearch.savedSuccess"));
      await load();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(t("settings.webSearch.savedFailed", { message: errMsg }));
      console.error("[WebSearchSettings] 保存配置失败:", err);
    } finally {
      setSaving(false);
    }
  }, [apiKeyDraft, baseURL, count, load, providerType, settingsSnapshot, t]);

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
    saving,
    message,
    error,
    save,
    refresh: load,
  };
}
