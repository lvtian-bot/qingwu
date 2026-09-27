import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import type { Translate } from "../i18n/core";
import type {
  ModelCatalog,
  ModelSelection,
  PermissionSelect,
  PresetOption,
} from "./protocol";

/** 权限预设值的展示词条 key（未知值由 permissionLabel 原样展示）。 */
const PERMISSION_LABELS: Record<string, string> = {
  "read-only": "composer.permission.labels.readOnly",
  "workspace-write": "composer.permission.labels.workspaceWrite",
  "danger-full-access": "composer.permission.labels.fullAccess",
  custom: "composer.permission.labels.custom",
};

/** 推理强度档位的展示词条 key（未知档位回退目录提供的 name）。 */
const EFFORT_LABELS: Record<string, string> = {
  off: "composer.effort.labels.off",
  minimal: "composer.effort.labels.minimal",
  low: "composer.effort.labels.low",
  medium: "composer.effort.labels.medium",
  high: "composer.effort.labels.high",
  max: "composer.effort.labels.max",
};

/** 权限预设展示：内置值查词条，未知值原样展示。 */
function permissionLabel(t: Translate, value: string): string {
  const key = PERMISSION_LABELS[value];
  return key ? t(key) : value;
}

/** 推理强度档位展示：内置档位查词条，未知档位回退指定文本。 */
function effortLabel(t: Translate, id: string, fallback: string): string {
  const key = EFFORT_LABELS[id];
  return key ? t(key) : fallback;
}

/** 权限选项描述：内置档位描述为词条 key，翻译展示；引擎目录提供的描述原样展示。 */
function permissionOptionDescription(
  t: Translate,
  option: PresetOption,
): string | undefined {
  const desc = option.description;
  if (desc === undefined || !desc.startsWith("composer.")) return desc;
  return t(desc);
}

/** 默认/保底权限选项（与 DSH 核心权限预设对齐；description 为词条 key，展示时翻译）。 */
export const DEFAULT_PERMISSION_OPTIONS: PresetOption[] = [
  {
    value: "workspace-write",
    name: "workspace-write",
    description: "composer.permission.descriptions.workspaceWrite",
  },
  {
    value: "read-only",
    name: "read-only",
    description: "composer.permission.descriptions.readOnly",
  },
  {
    value: "danger-full-access",
    name: "danger-full-access",
    description: "composer.permission.descriptions.fullAccess",
  },
];

/**
 * 从 permission 命名空间的 schemastery 序列化 schema 解析 defaultPreset 可选档位。
 * 官方设置行用 nodeAtPath(rehydrate(schema)) 取该 union 的 const 列表，这里直接走
 * 序列化形态（refs 引用表 + dict/list 索引），结构不符预期时返回空数组。
 */
export function permissionPresetsFromSchema(schema: unknown): PresetOption[] {
  try {
    const root = schema as {
      uid?: number;
      refs?: Record<string, unknown>;
      dict?: Record<string, unknown>;
    } | null;
    const refs = root?.refs;
    if (!root || !refs) return [];
    const resolve = (node: unknown): Record<string, unknown> | null => {
      const raw = typeof node === "number" ? refs[String(node)] : node;
      return typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : null;
    };
    const holder = [root, ...Object.values(refs)].find((node) => {
      const dict = (node as { dict?: Record<string, unknown> } | null)?.dict;
      return dict !== undefined && "defaultPreset" in dict;
    }) as { dict: Record<string, unknown> } | undefined;
    const union = holder ? resolve(holder.dict.defaultPreset) : null;
    if (!union || !Array.isArray(union.list)) return [];
    const options: PresetOption[] = [];
    for (const entry of union.list) {
      const node = resolve(entry);
      if (node && node.type === "const" && typeof node.value === "string") {
        options.push({ value: node.value, name: node.value });
      }
    }
    return options;
  } catch {
    return [];
  }
}

interface ComposerControlsProps {
  catalog: ModelCatalog | null;
  selection: ModelSelection | null;
  /** 权限选择；空态传新会话默认权限，无权限服务时传 null 隐藏控件。 */
  permission: PermissionSelect | null;
  /** 控件标题补充（空态标明"新会话默认权限"）。 */
  permissionHint?: string;
  onModelPick: (selection: ModelSelection) => void;
  onEffortPick: (effortId: string | undefined) => void;
  onPermissionPick: (value: string) => void;
}

/** 输入框工具行：权限选择器贴左，模型与推理强度两个下拉贴右（弹出层单开，点击外部关闭）。 */
export function ComposerControls({
  catalog,
  selection,
  permission,
  permissionHint,
  onModelPick,
  onEffortPick,
  onPermissionPick,
}: ComposerControlsProps) {
  const t = useT();
  const [open, setOpen] = useState<"model" | "effort" | "permission" | null>(
    null,
  );
  /** danger-full-access 的风险确认态（对齐官方确认交互）。 */
  const [confirmDanger, setConfirmDanger] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const model = useMemo(() => {
    if (!catalog || !selection) return null;
    return (
      catalog.groups
        .find((g) => g.id === selection.provider)
        ?.models.find((m) => m.id === selection.model) ?? null
    );
  }, [catalog, selection]);
  const reasoning = model?.reasoning;
  const efforts = reasoning?.efforts?.length
    ? reasoning.efforts
    : null;
  const effortId =
    selection?.reasoningEffort ?? reasoning?.defaultEffort;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
        setConfirmDanger(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 权限与模型目录相互独立：任一可用即渲染控件组
  if (!selection && !permission) return null;

  const toggle = (menu: "model" | "effort" | "permission") => {
    setOpen((prev) => (prev === menu ? null : menu));
    setConfirmDanger(false);
  };

  /** 模型 pill 文案：只呈现模型名；当前思考档位由相邻的推理强度 pill 常显。 */
  const modelPillText = model?.name ?? selection?.model ?? t("composer.selectModel");

  return (
    <div className="native-composer-controls" ref={rootRef}>
      {permission && (
        <div className="native-picker native-picker-permission">
          <button
            className={`native-pill${open === "permission" ? " active" : ""}`}
            onClick={() => toggle("permission")}
            title={permissionHint ?? t("composer.permissionMode")}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            </svg>
            <span className="native-pill-text">
              {permissionLabel(t, permission.currentValue)}
            </span>
            <svg
              className="native-pill-chevron"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open === "permission" && (
            <div className="native-popover">
              {permission.options.map((option) => (
                <button
                  key={option.value}
                  className={`native-popover-item${permission.currentValue === option.value ? " active" : ""}`}
                  onClick={() => {
                    if (
                      option.value === "danger-full-access" &&
                      !confirmDanger
                    ) {
                      setConfirmDanger(true);
                      return;
                    }
                    onPermissionPick(option.value);
                    setOpen(null);
                    setConfirmDanger(false);
                  }}
                  title={permissionOptionDescription(t, option)}
                >
                  <span className="native-popover-item-name">
                    {permissionLabel(t, option.value)}
                  </span>
                </button>
              ))}
              {confirmDanger && (
                <div className="native-popover-confirm">
                <div className="native-popover-confirm-text">
                  {t("composer.fullAccessWarning")}
                </div>
                  <div className="native-popover-confirm-actions">
                    <button
                      className="native-popover-confirm-cancel"
                      onClick={() => {
                        setConfirmDanger(false);
                        setOpen(null);
                      }}
                    >
                      {t("composer.cancel")}
                    </button>
                    <button
                      className="native-popover-confirm-go"
                      onClick={() => {
                        onPermissionPick("danger-full-access");
                        setOpen(null);
                        setConfirmDanger(false);
                      }}
                    >
                      {t("composer.enableFullAccess")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <span className="native-composer-controls-spacer" />

      <div className="native-picker native-picker-end native-picker-model">
        <button
          className={`native-pill${open === "model" ? " active" : ""}`}
          onClick={() => toggle("model")}
          title={t("composer.selectModel")}
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
          </svg>
          <span className="native-pill-text">{modelPillText}</span>
          <svg
            className="native-pill-chevron"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {open === "model" && (
          <div className="native-popover">
            {catalog ? (
              catalog.groups.map((group) => (
                <div key={group.id} className="native-popover-group">
                  <div className="native-popover-group-title">{group.name}</div>
                  {group.models.map((m) => (
                    <button
                      key={m.id}
                      className={`native-popover-item${
                        selection?.provider === group.id &&
                        selection?.model === m.id
                          ? " active"
                          : ""
                      }`}
                      onClick={() => {
                        onModelPick({ provider: group.id, model: m.id });
                        setOpen(null);
                      }}
                      title={m.description}
                    >
                      <span className="native-popover-item-name">{m.name}</span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="native-popover-empty">
                {t("composer.modelCatalogUnavailable")}
              </div>
            )}
          </div>
        )}
      </div>

      {efforts && (
        <div className="native-picker native-picker-end native-picker-effort">
          <button
            className={`native-pill${open === "effort" ? " active" : ""}`}
            onClick={() => toggle("effort")}
            title={t("composer.reasoningEffort")}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3a6 6 0 0 0 0 12c0 2 0 3-2 4 1-2 0-2 2-2a6 6 0 0 0 0-12Z" />
            </svg>
            <span className="native-pill-text">
              {effortId
                ? effortLabel(t, effortId, effortId)
                : t("composer.effortDefault")}
            </span>
            <svg
              className="native-pill-chevron"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open === "effort" && (
            <div className="native-popover">
              {reasoning?.defaultEffort === undefined && (
                <button
                  key="provider-default"
                  className={`native-popover-item${effortId === undefined ? " active" : ""}`}
                  onClick={() => {
                    onEffortPick(undefined);
                    setOpen(null);
                  }}
                  title={t("composer.providerEffortTitle")}
                >
                  <span className="native-popover-item-name">
                    {t("composer.effortDefault")}
                  </span>
                </button>
              )}
              {efforts.map((effort) => (
                <button
                  key={effort.id}
                  className={`native-popover-item${effortId === effort.id ? " active" : ""}`}
                  onClick={() => {
                    onEffortPick(effort.id);
                    setOpen(null);
                  }}
                  title={effort.description}
                >
                  <span className="native-popover-item-name">
                    {effortLabel(t, effort.id, effort.name)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
