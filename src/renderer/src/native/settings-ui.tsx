import type { ReactNode } from "react";
import type { CustomModelEntry } from "./settings-domain";

/** 行式设置项：标题与描述在左，控件在右。 */
export function SettingsRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="native-settings-row">
      <div className="native-settings-row-text">
        <div className="native-settings-row-title">{label}</div>
        <div className="native-settings-row-desc">{desc}</div>
      </div>
      <div className="native-settings-row-control">{children}</div>
    </div>
  );
}

export function SettingsSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`native-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="native-switch-knob" />
    </button>
  );
}

/** 密钥输入框的明文/密文切换眼睛按钮。 */
export function KeyVisibilityToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="native-provider-visible-toggle"
      onClick={onToggle}
      title={visible ? "隐藏密钥" : "显示密钥"}
    >
      {visible ? (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7.029 7.029 0 0 0 2.79-.588zM5.21 3.088A7.028 7.028 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474L5.21 3.089z" />
          <path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829l-2.83-2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171-5.006a.75.75 0 0 1 1.06 1.06l-12 12a.75.75 0 0 1-1.06-1.06l12-12z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z" />
          <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z" />
        </svg>
      )}
    </button>
  );
}

/** 可编辑模型清单中的单个模型行（显示名 + ID + 推理标记 + 移除按钮）。 */
export function ModelItemRow({
  model,
  onRemove,
}: {
  model: CustomModelEntry;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="native-model-item">
      <div className="native-settings-row-text">
        <div className="native-model-name">
          {model.name || model.id}
          {model.name && model.name !== model.id && (
            <span className="native-model-id">{model.id}</span>
          )}
        </div>
      </div>
      <div className="native-model-item-side">
        {model.reasoning && <span className="native-model-tag">推理</span>}
        <button
          type="button"
          className="native-model-remove-btn"
          onClick={() => onRemove(model.id)}
          title="移除此模型"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** 模型清单底部的手动添加行（ID + 显示名 + 推理勾选）。 */
export function ModelAddRow({
  idValue,
  nameValue,
  reasoning,
  onIdChange,
  onNameChange,
  onReasoningChange,
  onAdd,
}: {
  idValue: string;
  nameValue: string;
  reasoning: boolean;
  onIdChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onReasoningChange: (value: boolean) => void;
  onAdd: () => void;
}) {
  return (
    <div className="native-model-add-row">
      <input
        type="text"
        className="native-settings-input"
        placeholder="模型 ID (例如 gpt-4o)"
        value={idValue}
        onChange={(e) => onIdChange(e.target.value)}
      />
      <input
        type="text"
        className="native-settings-input"
        placeholder="显示名称 (可选)"
        value={nameValue}
        onChange={(e) => onNameChange(e.target.value)}
      />
      <label className="native-model-checkbox-label">
        <input
          type="checkbox"
          checked={reasoning}
          onChange={(e) => onReasoningChange(e.target.checked)}
        />
        <span>推理</span>
      </label>
      <button
        type="button"
        className="native-btn native-btn-secondary"
        disabled={!idValue.trim()}
        onClick={onAdd}
      >
        添加模型
      </button>
    </div>
  );
}
