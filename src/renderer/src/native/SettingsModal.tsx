import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "../../../shared/types";
import {
  Endpoints,
  type CredentialInfo,
  type ModelCatalog,
  type SettingsDescribeValue,
} from "./protocol";
import { rpc } from "./rpc";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  modelCatalog?: ModelCatalog | null;
}

type TabKey = "models" | "defaults" | "general" | "application";

interface ProviderItem {
  id: string;
  name: string;
  ref: string;
  desc: string;
}

const COMMON_PROVIDERS: ProviderItem[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    ref: "DEEPSEEK_API_KEY",
    desc: "DeepSeek 官方开放平台模型服务 (deepseek-chat / deepseek-reasoner)",
  },
  {
    id: "openai",
    name: "OpenAI",
    ref: "OPENAI_API_KEY",
    desc: "OpenAI 官方 API 服务 (GPT-4o, o1, o3-mini 等)",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    ref: "ANTHROPIC_API_KEY",
    desc: "Anthropic Claude 官方模型服务 (Claude 3.5 Sonnet / Haiku)",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow 硅基流动",
    ref: "SILICONFLOW_API_KEY",
    desc: "硅基流动模型云服务 (含开源满血 DeepSeek-R1 / V3 等)",
  },
  {
    id: "minimax",
    name: "MiniMax",
    ref: "MINIMAX_API_KEY",
    desc: "MiniMax 开放平台大语言模型与语音服务",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    ref: "GEMINI_API_KEY",
    desc: "Google AI Studio / Gemini API 官方模型服务",
  },
];

export function SettingsModal({
  open,
  onClose,
  modelCatalog,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("models");

  // 1. 青梧应用级设置
  const [appSettings, setAppSettings] = useState<AppSettings>({
    closeToTray: true,
    uiMode: "native",
  });

  // 2. DSH 凭据状态与输入暂存
  const [credentials, setCredentials] = useState<Record<string, CredentialInfo>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});
  const [credLoading, setCredLoading] = useState(false);
  const [credMessage, setCredMessage] = useState<string | null>(null);

  // 3. DSH 默认值 (settings describe)
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsDescribeValue | null>(null);
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
      console.error("[SettingsModal] 读取应用设置失败", e);
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
      console.error("[SettingsModal] 保存应用设置失败", e);
    }
  };

  // 读取 DSH 凭据状态
  const loadCredentials = useCallback(async () => {
    try {
      setCredLoading(true);
      const refs = COMMON_PROVIDERS.map((p) => p.ref);
      const res = await rpc<Record<string, CredentialInfo>>(
        Endpoints.credentialsDescribe,
        { refs },
      );
      if (res && typeof res === "object") {
        setCredentials(res);
      }
    } catch (e) {
      console.error("[SettingsModal] 读取凭据失败", e);
    } finally {
      setCredLoading(false);
    }
  }, []);

  // 设置 API Key
  const handleSaveCredential = async (ref: string) => {
    const rawVal = keyInputs[ref];
    if (!rawVal || !rawVal.trim()) return;
    try {
      setCredLoading(true);
      setCredMessage(null);
      await rpc<void>(Endpoints.credentialsSet, {
        ref,
        value: rawVal.trim(),
      });
      setKeyInputs((prev) => ({ ...prev, [ref]: "" }));
      setCredMessage(`凭据 ${ref} 保存成功`);
      await loadCredentials();
    } catch (e) {
      setCredMessage(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCredLoading(false);
    }
  };

  // 删除 / 清除 API Key
  const handleUnsetCredential = async (ref: string) => {
    try {
      setCredLoading(true);
      setCredMessage(null);
      await rpc<void>(Endpoints.credentialsUnset, { ref });
      setKeyInputs((prev) => ({ ...prev, [ref]: "" }));
      setCredMessage(`凭据 ${ref} 已清除`);
      await loadCredentials();
    } catch (e) {
      setCredMessage(`清除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCredLoading(false);
    }
  };

  // 读取 DSH Settings (命名空间)
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
      }
    } catch (e) {
      console.error("[SettingsModal] 读取 settings 失败", e);
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
      setSettingsMessage(`更新失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 打开底层 settings.json
  const handleOpenDshConfig = async () => {
    try {
      await rpc(Endpoints.settingsOpenSettingsDocument, {});
    } catch (e) {
      setSettingsMessage(`打开配置文件异常: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 打开青梧本地数据目录
  const handleOpenAppData = async () => {
    if (window.qingwu?.openUserDataFolder) {
      await window.qingwu.openUserDataFolder();
    }
  };

  // 打开时初始化数据
  useEffect(() => {
    if (!open) return;
    void loadAppSettings();
    void loadCredentials();
    void loadSettings();
  }, [open, loadAppSettings, loadCredentials, loadSettings]);

  // 按 Esc 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isDshGroup =
    activeTab === "models" || activeTab === "defaults" || activeTab === "general";

  return (
    <div className="native-modal-overlay" onClick={onClose}>
      <div
        className="native-modal-container native-settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="设置面板"
      >
        {/* 顶部标题栏 */}
        <div className="native-settings-header">
          <div className="native-settings-title-wrap">
            <span className="native-settings-title">设置</span>
          </div>
          <button
            type="button"
            className="native-settings-close-btn"
            onClick={onClose}
            title="关闭 (Esc)"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
            </svg>
          </button>
        </div>

        <div className="native-settings-body">
          {/* 左侧分类导航 */}
          <aside className="native-settings-sidebar">
            <div className="native-settings-nav-group">
              <div className="native-settings-group-title">引擎设置 (与 DeepSeek 共享)</div>
              <button
                type="button"
                className={`native-settings-nav-item ${activeTab === "models" ? "active" : ""}`}
                onClick={() => setActiveTab("models")}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="currentColor"
                  className="native-settings-nav-icon"
                >
                  <path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H2.5A1.5 1.5 0 0 0 1 4.5v9A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 3H11v-.5A1.5 1.5 0 0 0 9.5 1h-3zm0 1h3a.5.5 0 0 1 .5.5V3H6v-.5a.5.5 0 0 1 .5-.5zM2 4.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V6H2V4.5zM2 7h12v6.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V7z" />
                </svg>
                <span>模型与凭据</span>
              </button>
              <button
                type="button"
                className={`native-settings-nav-item ${activeTab === "defaults" ? "active" : ""}`}
                onClick={() => setActiveTab("defaults")}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="currentColor"
                  className="native-settings-nav-icon"
                >
                  <path d="M11.5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9.05 3a2.5 2.5 0 0 1 4.9 0H15a.5.5 0 0 1 0 1h-1.05a2.5 2.5 0 0 1-4.9 0H1a.5.5 0 0 1 0-1h8.05zM4.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM2.05 8a2.5 2.5 0 0 1 4.9 0H15a.5.5 0 0 1 0 1H6.95a2.5 2.5 0 0 1-4.9 0H1a.5.5 0 0 1 0-1h1.05zm6.45 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-2.45 1a2.5 2.5 0 0 1 4.9 0H15a.5.5 0 0 1 0 1H10.9a2.5 2.5 0 0 1-4.9 0H1a.5.5 0 0 1 0-1h5.05z" />
                </svg>
                <span>默认值</span>
              </button>
              <button
                type="button"
                className={`native-settings-nav-item ${activeTab === "general" ? "active" : ""}`}
                onClick={() => setActiveTab("general")}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="currentColor"
                  className="native-settings-nav-icon"
                >
                  <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM9.75 8a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z" />
                  <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.185 1.184l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.185l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
                </svg>
                <span>通用设置</span>
              </button>
            </div>

            <div className="native-settings-nav-group">
              <div className="native-settings-group-title">青梧设置 (桌面客户端)</div>
              <button
                type="button"
                className={`native-settings-nav-item ${activeTab === "application" ? "active" : ""}`}
                onClick={() => setActiveTab("application")}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="currentColor"
                  className="native-settings-nav-icon"
                >
                  <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11zM2.5 2a.5.5 0 0 0-.5.5V4h12V2.5a.5.5 0 0 0-.5-.5h-11zM14 5H2v8.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V5z" />
                </svg>
                <span>窗口与常规</span>
              </button>
            </div>
          </aside>

          {/* 右侧表单内容 */}
          <main className="native-settings-content">
            {/* 存储位置透明度横幅 */}
            <div className={`native-settings-storage-banner ${isDshGroup ? "dsh" : "app"}`}>
              <div className="native-settings-storage-icon">
                {isDshGroup ? (
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                    <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm1 12H7V7h2v5zm0-6H7V4h2v2z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                    <path d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V3A1.5 1.5 0 0 0 12 1.5H4zM3.5 3a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3z" />
                  </svg>
                )}
              </div>
              <div className="native-settings-storage-desc">
                {isDshGroup ? (
                  <>
                    <strong>存储位置：DSH 引擎配置目录 (~/.dsh)</strong>
                    <span>
                      此分区配置直接写入底层引擎并与 DeepSeek WebUI 共享互通，后续官方推出桌面版时可直接继承。
                    </span>
                  </>
                ) : (
                  <>
                    <strong>存储位置：青梧本地数据目录 (%APPDATA%/qingwu/settings.json)</strong>
                    <span>此分区配置存储于本地桌面客户端，仅对当前青梧桌面环境生效。</span>
                  </>
                )}
              </div>
            </div>

            {/* TAB 1: 模型与凭据 */}
            {activeTab === "models" && (
              <div className="native-settings-panel">
                <div className="native-settings-panel-header">
                  <h3>模型服务商与 API 密钥</h3>
                  <p>管理 LLM 服务商凭据。填入的密钥安全保存在引擎凭据安全区，严格脱敏不回显。</p>
                </div>

                {credMessage && <div className="native-settings-alert">{credMessage}</div>}

                <div className="native-provider-list">
                  {COMMON_PROVIDERS.map((provider) => {
                    const info = credentials[provider.ref];
                    const isConfigured = Boolean(info?.configured);
                    const inputValue = keyInputs[provider.ref] ?? "";
                    const visible = keyVisible[provider.ref] ?? false;

                    return (
                      <div key={provider.id} className="native-provider-card">
                        <div className="native-provider-card-head">
                          <div className="native-provider-info">
                            <span className="native-provider-name">{provider.name}</span>
                            <span className="native-provider-ref-code">{provider.ref}</span>
                          </div>
                          <span
                            className={`native-provider-status-badge ${
                              isConfigured ? "configured" : "unconfigured"
                            }`}
                          >
                            {isConfigured ? "已配置" : "未配置"}
                          </span>
                        </div>
                        <div className="native-provider-card-desc">{provider.desc}</div>

                        <div className="native-provider-card-action">
                          <div className="native-provider-input-wrap">
                            <input
                              type={visible ? "text" : "password"}
                              className="native-settings-input"
                              placeholder={
                                isConfigured
                                  ? "已配置 (输入新密钥可覆盖更新)"
                                  : "输入 API Key 凭据"
                              }
                              value={inputValue}
                              onChange={(e) =>
                                setKeyInputs((prev) => ({
                                  ...prev,
                                  [provider.ref]: e.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="native-provider-visible-toggle"
                              onClick={() =>
                                setKeyVisible((prev) => ({
                                  ...prev,
                                  [provider.ref]: !visible,
                                }))
                              }
                              title={visible ? "隐藏密钥" : "显示密钥"}
                            >
                              {visible ? (
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
                          <button
                            type="button"
                            className="native-btn native-btn-primary"
                            disabled={credLoading || !inputValue.trim()}
                            onClick={() => handleSaveCredential(provider.ref)}
                          >
                            保存
                          </button>
                          {isConfigured && (
                            <button
                              type="button"
                              className="native-btn native-btn-danger"
                              disabled={credLoading}
                              onClick={() => handleUnsetCredential(provider.ref)}
                            >
                              清除
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: 默认值 */}
            {activeTab === "defaults" && (
              <div className="native-settings-panel">
                <div className="native-settings-panel-header">
                  <h3>新会话默认行为</h3>
                  <p>配置新建会话时的默认执行权限与首选模型设定。</p>
                </div>

                {settingsMessage && <div className="native-settings-alert">{settingsMessage}</div>}

                <div className="native-settings-section">
                  <div className="native-settings-label">新会话执行权限 (默认模式)</div>
                  <div className="native-settings-desc">
                    决定新建会话在执行命令与修改文件时的审批策略。
                  </div>

                  <div className="native-settings-options">
                    <label className="native-radio-card">
                      <input
                        type="radio"
                        name="defaultPreset"
                        value="standard"
                        checked={defaultPreset === "standard"}
                        onChange={() => handleSaveDefaultPreset("standard")}
                      />
                      <div className="native-radio-card-content">
                        <span className="native-radio-card-title">标准询问 (Standard)</span>
                        <span className="native-radio-card-desc">
                          常规命令与文件编辑前征询确认，兼顾安全与效率。
                        </span>
                      </div>
                    </label>

                    <label className="native-radio-card">
                      <input
                        type="radio"
                        name="defaultPreset"
                        value="elevated"
                        checked={defaultPreset === "elevated"}
                        onChange={() => handleSaveDefaultPreset("elevated")}
                      />
                      <div className="native-radio-card-content">
                        <span className="native-radio-card-title">完全授权 (Elevated)</span>
                        <span className="native-radio-card-desc">
                          自动批准日常操作与命令，适合专注快速产出。
                        </span>
                      </div>
                    </label>

                    <label className="native-radio-card">
                      <input
                        type="radio"
                        name="defaultPreset"
                        value="restricted"
                        checked={defaultPreset === "restricted"}
                        onChange={() => handleSaveDefaultPreset("restricted")}
                      />
                      <div className="native-radio-card-content">
                        <span className="native-radio-card-title">安全只读 (Restricted)</span>
                        <span className="native-radio-card-desc">
                          严格限制写入与高危指令，仅允许只读分析。
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {modelOptions.length > 0 && (
                  <div className="native-settings-section">
                    <div className="native-settings-label">首选模型选择</div>
                    <div className="native-settings-desc">
                      从已启用的模型服务商中选择默认模型。
                    </div>
                    <select
                      className="native-settings-select"
                      value={defaultModelKey}
                      onChange={(e) => setDefaultModelKey(e.target.value)}
                    >
                      <option value="">跟随引擎默认推选</option>
                      {modelOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: 通用设置 */}
            {activeTab === "general" && (
              <div className="native-settings-panel">
                <div className="native-settings-panel-header">
                  <h3>通用与底层文件</h3>
                  <p>查看语言设定与底层引擎配置文件快捷入口。</p>
                </div>

                <div className="native-settings-section">
                  <div className="native-settings-label">界面语言 (Language)</div>
                  <div className="native-settings-desc">当前桌面客户端与底层引擎的界面语言。</div>
                  <select className="native-settings-select" defaultValue="zh" disabled>
                    <option value="zh">简体中文 (Chinese Simplified)</option>
                    <option value="en">English (跟随系统)</option>
                  </select>
                </div>

                <div className="native-settings-section">
                  <div className="native-settings-label">底层引擎配置文件</div>
                  <div className="native-settings-desc">
                    DSH 引擎在用户目录下的全局配置文件 (<code>~/.dsh/settings.json</code>)，包含所有已注册的扩展参数。
                  </div>
                  <button
                    type="button"
                    className="native-btn native-btn-secondary"
                    onClick={handleOpenDshConfig}
                  >
                    在默认编辑器中打开 settings.json
                  </button>
                </div>
              </div>
            )}

            {/* TAB 4: 窗口与常规 (青梧专有) */}
            {activeTab === "application" && (
              <div className="native-settings-panel">
                <div className="native-settings-panel-header">
                  <h3>窗口与桌面常规</h3>
                  <p>管理青梧桌面窗口关闭行为与启动偏好。</p>
                </div>

                <div className="native-settings-section">
                  <div className="native-settings-label">窗口关闭行为</div>
                  <div className="native-settings-desc">点击主窗口右上角的关闭按钮 (✕) 时的动作。</div>

                  <div className="native-settings-options">
                    <label className="native-radio-card">
                      <input
                        type="radio"
                        name="closeToTray"
                        checked={appSettings.closeToTray}
                        onChange={() => handleUpdateAppSetting({ closeToTray: true })}
                      />
                      <div className="native-radio-card-content">
                        <span className="native-radio-card-title">最小化到系统托盘 (推荐)</span>
                        <span className="native-radio-card-desc">
                          窗口关闭后应用常驻系统托盘，保持后台 Agent 会话不中断，完成后提供蓝点提醒。
                        </span>
                      </div>
                    </label>

                    <label className="native-radio-card">
                      <input
                        type="radio"
                        name="closeToTray"
                        checked={!appSettings.closeToTray}
                        onChange={() => handleUpdateAppSetting({ closeToTray: false })}
                      />
                      <div className="native-radio-card-content">
                        <span className="native-radio-card-title">直接退出青梧</span>
                        <span className="native-radio-card-desc">
                          关闭窗口时立即清理后台引擎并完全退出软件。
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="native-settings-section">
                  <div className="native-settings-label">默认界面</div>
                  <div className="native-settings-desc">启动青梧客户端时默认展示的交互视图。</div>

                  <div className="native-settings-options">
                    <label className="native-radio-card">
                      <input
                        type="radio"
                        name="uiMode"
                        checked={appSettings.uiMode === "native"}
                        onChange={() => handleUpdateAppSetting({ uiMode: "native" })}
                      />
                      <div className="native-radio-card-content">
                        <span className="native-radio-card-title">青梧界面 (自研桌面工作台)</span>
                        <span className="native-radio-card-desc">
                          专为办公 Agent 打造的快速会话与项目管理界面。
                        </span>
                      </div>
                    </label>

                    <label className="native-radio-card">
                      <input
                        type="radio"
                        name="uiMode"
                        checked={appSettings.uiMode === "official"}
                        onChange={() => handleUpdateAppSetting({ uiMode: "official" })}
                      />
                      <div className="native-radio-card-content">
                        <span className="native-radio-card-title">DeepSeek 官方界面</span>
                        <span className="native-radio-card-desc">
                          加载随包内置的官方 Web 界面作为对比参照。
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="native-settings-section">
                  <div className="native-settings-label">青梧应用数据目录</div>
                  <div className="native-settings-desc">
                    存放桌面窗口状态、应用配置与运行日志的本地目录 (<code>%APPDATA%/qingwu</code>)。
                  </div>
                  <button
                    type="button"
                    className="native-btn native-btn-secondary"
                    onClick={handleOpenAppData}
                  >
                    在文件管理器中打开数据目录
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
