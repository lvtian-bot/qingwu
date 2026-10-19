import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { Endpoints, type CredentialInfo, type SettingsDescribeValue } from "./protocol";
import { rpc } from "./rpc";

export const DEFAULT_SEARCH_API_BASE_URL = "https://api.deepseek.com/v1/tools";
export const DEFAULT_SEARCH_COUNT = 10;

export interface WebSearchSettingsOptions {
  /** 当凭据（API Key）更新保存后触发，用于联动刷新模型设置等其他分区的凭据状态 */
  onRefreshCredentials?: () => void;
}

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
  const [providerType, setProviderType] = useState<"deepseek" | "custom">("deepseek");
  const [loadedProviders, setLoadedProviders] = useState<{
    searchProvider: string;
    fetchProvider: string;
  }>({
    searchProvider: "deepseek-search-api",
    fetchProvider: "deepseek-fetch-api",
  });
  const [baseURL, setBaseURL] = useState<string>("");
  const [count, setCount] = useState<number>(DEFAULT_SEARCH_COUNT);
  const [countDirty, setCountDirty] = useState<boolean>(false);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [apiKeyDraft, setApiKeyDraft] = useState<string>("");
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
        setLoadedProviders({ searchProvider, fetchProvider });

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

        const currentCount = typeof apiVal?.count === "number" ? apiVal.count : DEFAULT_SEARCH_COUNT;
        setCount(currentCount);
        setCountDirty(false);

        // 如果配置了非默认的 searchProvider 或者自定义了端点，则识别为自定义模式
        if (
          searchProvider !== "deepseek-search-api" ||
          (currentBaseURL && currentBaseURL !== DEFAULT_SEARCH_API_BASE_URL)
        ) {
          setProviderType("custom");
        } else {
          setProviderType("deepseek");
        }
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

  const handleSetCount = useCallback((nextCount: number) => {
    setCount(nextCount);
    setCountDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!settingsSnapshot || !writable) {
      setError(
        !settingsSnapshot
          ? t("settings.webSearch.loadFailed")
          : t("settings.webSearch.readOnly"),
      );
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      let keySaved = false;
      // 1. 保存凭据（仅当密钥可写且用户输入了新 Key 时执行，环境变量只读时不破坏其余设置保存）
      if (keyWritable && apiKeyDraft.trim()) {
        await rpc(Endpoints.credentialsSet, {
          ref: keyRef,
          value: apiKeyDraft.trim(),
        });
        setApiKeyDraft("");
        setHasKey(true);
        keySaved = true;
      }

      // 2. 保存 web 命名空间：选择 DeepSeek 官方时切换至官方 API；自定义模式保留已有的 provider 配置
      const targetSearchProvider =
        providerType === "deepseek"
          ? "deepseek-search-api"
          : loadedProviders.searchProvider || "deepseek-search-api";
      const targetFetchProvider =
        providerType === "deepseek"
          ? "deepseek-fetch-api"
          : loadedProviders.fetchProvider || "deepseek-fetch-api";

      const webNs = settingsSnapshot.namespaces.find((ns) => ns.ns === "web");
      await rpc(Endpoints.settingsUpdate, {
        ns: "web",
        patch: {
          searchProvider: targetSearchProvider,
          fetchProvider: targetFetchProvider,
        },
        expectedRevision: webNs?.revision,
      });

      // 3. 通过 settings/mutate 原子更新 web-deepseek-api 命名空间
      const apiNs = settingsSnapshot.namespaces.find((ns) => ns.ns === "web-deepseek-api");
      const apiVal = apiNs?.value as { baseURL?: string } | undefined;
      const hasBaseURLOverride = typeof apiVal?.baseURL === "string" && apiVal.baseURL !== "";
      const normalizedBaseURL = baseURL.trim();

      const ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }> = [];

      // 仅当用户真正修改过 count 时才写入该覆盖项；未动过则保留底层默认或 profile 继承
      if (countDirty) {
        const normalizedCount = Math.min(50, Math.max(1, count));
        ops.push({ op: "set", path: ["count"], value: normalizedCount });
      }

      // 端点处理：自定义且非空则 set；选默认或清空且原存在覆盖则 unset；原未覆盖且选默认则不产生无意义操作
      if (providerType === "custom" && normalizedBaseURL) {
        ops.push({ op: "set", path: ["baseURL"], value: normalizedBaseURL });
      } else if (hasBaseURLOverride) {
        ops.push({ op: "unset", path: ["baseURL"] });
      }

      if (ops.length > 0) {
        await rpc(Endpoints.settingsMutate, {
          ns: "web-deepseek-api",
          ops,
          expectedRevision: apiNs?.revision,
        });
      }

      setMessage(t("settings.webSearch.savedSuccess"));
      await load();

      // 若保存了共享凭据，同步通知外部刷新（如模型设置中的供应商列表）
      if (keySaved) {
        options?.onRefreshCredentials?.();
      }
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
    count,
    countDirty,
    keyRef,
    keyWritable,
    load,
    loadedProviders,
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
    setCount: handleSetCount,
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
