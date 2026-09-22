import { useCallback, useState } from "react";
import {
  Endpoints,
  type LlmDiscoveredModel,
  type LlmModelDiscoveryRequest,
} from "./protocol";
import { rpc } from "./rpc";
import { isHttpUrl } from "./settings-domain";

export interface ModelDiscovery {
  /** 接口拉取成功后的候选模型；null 表示未在弹层流程中。 */
  candidates: LlmDiscoveredModel[] | null;
  fetching: boolean;
  fetchError: string | null;
  setFetchError: (message: string | null) => void;
  closeCandidates: () => void;
  /** 从服务商接口拉取候选模型；地址无效时提示 invalidUrlMessage。 */
  discover: (params: {
    settingsNs: string;
    request: LlmModelDiscoveryRequest;
    invalidUrlMessage: string;
  }) => Promise<void>;
}

/** 候选模型拉取与多选弹层的共用状态（自定义服务商表单与供应商详情共用）。 */
export function useModelDiscovery(): ModelDiscovery {
  const [candidates, setCandidates] = useState<LlmDiscoveredModel[] | null>(
    null,
  );
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const discover = useCallback<ModelDiscovery["discover"]>(
    async ({ settingsNs, request, invalidUrlMessage }) => {
      const baseURL = (request.baseURL ?? "").trim();
      if (!baseURL || !isHttpUrl(baseURL)) {
        setFetchError(invalidUrlMessage);
        return;
      }
      setFetching(true);
      setFetchError(null);
      try {
        const res = await rpc<LlmDiscoveredModel[]>(
          Endpoints.llmDiscoverModels,
          {
            settingsNs,
            request: { ...request, baseURL },
          },
        );
        if (!res || res.length === 0) {
          setFetchError("服务商接口未返回任何候选模型，请手动输入添加");
        } else {
          setCandidates(res);
        }
      } catch (err) {
        setFetchError(
          `获取失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setFetching(false);
      }
    },
    [],
  );

  const closeCandidates = useCallback(() => setCandidates(null), []);

  return {
    candidates,
    fetching,
    fetchError,
    setFetchError,
    closeCandidates,
    discover,
  };
}
