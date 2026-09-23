/**
 * 模型与权限选择：模型目录加载、空态待应用选择、新会话默认权限读取，
 * 以及会话内/空态两套选择器的数据源与写回。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PERMISSION_OPTIONS,
  permissionPresetsFromSchema,
} from "./ComposerControls";
import {
  Endpoints,
  type ModelCatalog,
  type ModelSelection,
  type PermissionCatalog,
  type PermissionSelect,
  type PresetOption,
  type SessionSummary,
  type SettingsDescribeValue,
} from "./protocol";
import { rpc, toErrMsg } from "./rpc";

interface ModelSelectionOptions {
  sessions: SessionSummary[];
  currentId: string | null;
  refreshSessions: () => Promise<void>;
  setError: (message: string | null) => void;
}

export function useModelSelection({
  sessions,
  currentId,
  refreshSessions,
  setError,
}: ModelSelectionOptions) {
  /** 模型目录（provider 分组 + 默认选择），拉取失败仅降级选择器。 */
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
  /** 空态（尚未建会话）待应用的模型选择，发送时随会话创建写入。 */
  const [emptySelection, setEmptySelection] = useState<ModelSelection | null>(
    null,
  );
  /** 新会话默认权限（settings permission 命名空间 defaultPreset），空态选择器读写的对象。 */
  const [defaultPermission, setDefaultPermission] = useState<
    (PermissionSelect & { writable: boolean; revision: number }) | null
  >(null);
  /** 权限目录（permissionPresets/catalog 返回的完整可选与默认档位）。 */
  const [permissionCatalog, setPermissionCatalog] =
    useState<PermissionCatalog | null>(null);

  // 模型目录与界面生命周期解耦，失败静默降级（选择器显示目录不可用）
  const refreshModelCatalog = useCallback(async () => {
    try {
      setModelCatalog(await rpc<ModelCatalog>(Endpoints.sessionModelCatalog, {}));
    } catch {
      // 刷新失败保留现有目录；首次加载失败时维持空目录兜底
    }
  }, []);

  useEffect(() => {
    void refreshModelCatalog();
  }, [refreshModelCatalog]);

  /** 读取权限目录（permissionPresets/catalog）。 */
  const refreshPermissionCatalog = useCallback(async () => {
    try {
      setPermissionCatalog(
        await rpc<PermissionCatalog>(Endpoints.permissionPresetsCatalog, {}),
      );
    } catch {
      // 失败保留现有目录，依赖内置 DEFAULT_PERMISSION_OPTIONS 兜底
    }
  }, []);

  useEffect(() => {
    void refreshPermissionCatalog();
  }, [refreshPermissionCatalog]);

  const sessionOptions = useMemo<PresetOption[]>(() => {
    if (permissionCatalog?.options && permissionCatalog.options.length > 0) {
      return permissionCatalog.options;
    }
    return DEFAULT_PERMISSION_OPTIONS;
  }, [permissionCatalog]);

  const defaultOptions = useMemo<PresetOption[]>(() => {
    if (
      permissionCatalog?.defaultOptions &&
      permissionCatalog.defaultOptions.length > 0
    ) {
      return permissionCatalog.defaultOptions;
    }
    return DEFAULT_PERMISSION_OPTIONS;
  }, [permissionCatalog]);

  /** 读取新会话默认权限（settings/describe 的 permission 命名空间）。 */
  const refreshDefaultPermission = useCallback(async () => {
    try {
      const described = await rpc<SettingsDescribeValue>(
        Endpoints.settingsDescribe,
        {},
      );
      const view = described.namespaces.find(
        (entry) => entry.ns === "permission",
      );
      const value = view?.value;
      const current =
        typeof value === "object" && value !== null && "defaultPreset" in value
          ? value.defaultPreset
          : undefined;
      if (!view || typeof current !== "string") {
        setDefaultPermission(null);
        return;
      }
      const schemaOptions = permissionPresetsFromSchema(view.schema);
      const options =
        schemaOptions.length > 0 ? schemaOptions : defaultOptions;
      setDefaultPermission({
        options,
        currentValue: current,
        writable: described.writable,
        revision: view.revision,
      });
    } catch {
      setDefaultPermission(null);
    }
  }, [defaultOptions]);

  useEffect(() => {
    void refreshDefaultPermission();
  }, [refreshDefaultPermission]);

  /** 当前生效的模型选择：会话投影优先（next 含待生效），空态用待应用选择或目录默认。 */
  const currentModelSelection = useMemo<ModelSelection | null>(() => {
    if (currentId) {
      const projection = sessions.find((s) => s.sessionId === currentId)
        ?.projections?.values?.modelSelection;
      return (
        projection?.next ??
        projection?.lastUsed ??
        modelCatalog?.default ??
        null
      );
    }
    return emptySelection ?? modelCatalog?.default ?? null;
  }, [currentId, sessions, emptySelection, modelCatalog]);

  /** 权限选择器数据：会话内取该会话投影并补全选项，空态取新会话默认（settings permission.defaultPreset）。 */
  const currentPermission = useMemo<PermissionSelect | null>(() => {
    if (currentId) {
      const projection = sessions.find((s) => s.sessionId === currentId)
        ?.projections?.values?.permissions;
      if (!projection) return null;
      return {
        options: sessionOptions,
        currentValue:
          projection.currentValue ??
          defaultPermission?.currentValue ??
          "workspace-write",
      };
    }
    if (!defaultPermission) return null;
    return {
      ...defaultPermission,
      options: defaultOptions,
    };
  }, [currentId, sessions, defaultPermission, sessionOptions, defaultOptions]);

  /** 应用模型选择到会话并刷新投影（reasoningEffort 缺省用模型默认档）。 */
  const applyModelSelection = useCallback(
    async (selection: ModelSelection, sessionId: string) => {
      await rpc(Endpoints.sessionSelectModel, {
        request: { sessionId, ...selection },
      });
      await refreshSessions();
    },
    [refreshSessions],
  );

  /** 选择模型：会话内立即生效（下一轮起），空态暂存随建会话写入；强度回落新模型默认档。 */
  const handleModelPick = (selection: ModelSelection) => {
    if (currentId) {
      void applyModelSelection(selection, currentId).catch((err) =>
        setError(toErrMsg(err)),
      );
    } else {
      setEmptySelection(selection);
    }
  };

  /** 调整推理强度：在当前选择基础上覆盖 reasoningEffort（传 undefined 清除覆盖）。 */
  const handleEffortPick = (effortId: string | undefined) => {
    if (!currentModelSelection) return;
    const { reasoningEffort: _prev, ...rest } = currentModelSelection;
    const selection: ModelSelection = effortId
      ? { ...rest, reasoningEffort: effortId }
      : { ...rest };
    if (currentId) {
      void applyModelSelection(selection, currentId).catch((err) =>
        setError(toErrMsg(err)),
      );
    } else {
      setEmptySelection(selection);
    }
  };

  /**
   * 切换权限模式：会话内走宿主 /permission 命令（改该会话权限），
   * 空态写 settings permission.defaultPreset（改后续新建会话的默认权限）。
   */
  const handlePermissionPick = (value: string) => {
    if (currentId) {
      void (async () => {
        await rpc(Endpoints.commandsExecute, {
          agentId: currentId,
          line: `/permission ${value}`,
          submittedAttachments: [],
        });
        await refreshSessions();
      })().catch((err) => setError(toErrMsg(err)));
      return;
    }
    if (!defaultPermission?.writable) return;
    void (async () => {
      await rpc(Endpoints.settingsMutate, {
        ns: "permission",
        ops: [{ op: "set", path: ["defaultPreset"], value }],
        expectedRevision: defaultPermission.revision,
      });
      await refreshDefaultPermission();
    })().catch((err) => setError(toErrMsg(err)));
  };

  return {
    modelCatalog,
    refreshModelCatalog,
    emptySelection,
    setEmptySelection,
    currentModelSelection,
    currentPermission,
    handleModelPick,
    handleEffortPick,
    handlePermissionPick,
  };
}
