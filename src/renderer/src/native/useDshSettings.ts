import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { Endpoints, type SettingsDescribeValue } from "./protocol";
import { rpc } from "./rpc";

/**
 * DSH 引擎设置域控制器：权限预设与新会话默认模型的读取/写入、
 * 打开底层配置文件入口，以及跨分区共享的设置操作提示。
 */
export interface DshSettingsController {
  settingsMessage: string | null;
  /** 供各分区上报操作失败提示（在模型设置与权限分区展示）。 */
  reportError: (message: string) => void;
  defaultPreset: string;
  defaultModelKey: string;
  saveDefaultPreset: (preset: string) => Promise<void>;
  saveDefaultModel: (key: string) => Promise<void>;
  /** 打开底层 settings.json。 */
  openDshConfig: () => Promise<void>;
}

export function useDshSettings(): DshSettingsController {
  const t = useT();
  const [settingsSnapshot, setSettingsSnapshot] =
    useState<SettingsDescribeValue | null>(null);
  const [defaultPreset, setDefaultPreset] = useState<string>("workspace-write");
  const [defaultModelKey, setDefaultModelKey] = useState<string>("");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

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
        const permission = permNs?.value as { defaultPreset?: string } | undefined;
        setDefaultPreset(permission?.defaultPreset || "workspace-write");
        const admNs = res.namespaces.find(
          (ns) => ns.ns === "agent-default-model",
        );
        const selection = admNs?.value as
          | { provider?: string; model?: string }
          | undefined;
        setDefaultModelKey(
          selection?.provider && selection.model
            ? `${selection.provider}/${selection.model}`
            : "",
        );
      }
    } catch (e) {
      console.error("[SettingsPage] 读取 settings 失败", e);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const reportError = useCallback((message: string) => {
    setSettingsMessage(message);
  }, []);

  // 更新默认权限预设
  const saveDefaultPreset = useCallback(
    async (preset: string) => {
      try {
        setSettingsMessage(null);
        const permNs = settingsSnapshot?.namespaces.find(
          (ns) => ns.ns === "permission",
        );
        const rev = permNs ? permNs.revision : undefined;
        await rpc(Endpoints.settingsUpdate, {
          ns: "permission",
          patch: { defaultPreset: preset },
          expectedRevision: rev,
        });
        setDefaultPreset(preset);
        setSettingsMessage(t("settings.messages.permissionUpdated"));
        await loadSettings();
      } catch (e) {
        setSettingsMessage(
          t("settings.messages.updateFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        await loadSettings();
      }
    },
    [settingsSnapshot, loadSettings, t],
  );

  // 更新新会话默认模型（写入引擎 agent-default-model 命名空间，落盘并在重开后保持）
  const saveDefaultModel = useCallback(
    async (key: string) => {
      const sep = key.indexOf("/");
      if (key !== "" && (sep <= 0 || sep === key.length - 1)) return;
      const provider = key.slice(0, sep);
      const model = key.slice(sep + 1);
      try {
        setSettingsMessage(null);
        const admNs = settingsSnapshot?.namespaces.find(
          (ns) => ns.ns === "agent-default-model",
        );
        if (key === "") {
          // 复用引擎的字段恢复机制，回到继承配置，不写入空模型。
          await rpc(Endpoints.settingsMutate, {
            ns: "agent-default-model",
            ops: [
              { op: "unset", path: ["provider"] },
              { op: "unset", path: ["model"] },
            ],
            expectedRevision: admNs?.revision,
          });
        } else {
          await rpc(Endpoints.settingsUpdate, {
            ns: "agent-default-model",
            patch: { provider, model },
            expectedRevision: admNs?.revision,
          });
        }
        setDefaultModelKey(key);
        setSettingsMessage(t("settings.messages.modelUpdated"));
        await loadSettings();
      } catch (e) {
        setSettingsMessage(
          t("settings.messages.updateFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        await loadSettings();
      }
    },
    [settingsSnapshot, loadSettings, t],
  );

  // 打开底层 settings.json
  const openDshConfig = useCallback(async () => {
    try {
      await rpc(Endpoints.settingsOpenSettingsDocument, {});
    } catch (e) {
      setSettingsMessage(
        t("settings.messages.openConfigFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }, [t]);

  return {
    settingsMessage,
    reportError,
    defaultPreset,
    defaultModelKey,
    saveDefaultPreset,
    saveDefaultModel,
    openDshConfig,
  };
}
