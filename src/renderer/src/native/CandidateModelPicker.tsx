import { useMemo, useState } from "react";
import type { LlmDiscoveredModel } from "./protocol";

/** 候选模型多选弹层：从服务商接口拉取成功后供用户勾选添加。 */
export function CandidateModelPicker(props: {
  candidates: LlmDiscoveredModel[];
  onAdd: (selected: LlmDiscoveredModel[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(props.candidates.map((c) => c.id)),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.candidates;
    return props.candidates.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        (c.name && c.name.toLowerCase().includes(q)),
    );
  }, [props.candidates, query]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  const toggleAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const c of filtered) next.delete(c.id);
      } else {
        for (const c of filtered) next.add(c.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    const chosen = props.candidates.filter((c) => selectedIds.has(c.id));
    props.onAdd(chosen);
  };

  return (
    <div className="native-model-picker-overlay" onClick={props.onClose}>
      <div
        className="native-model-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="native-model-picker-header">
          <div className="native-model-picker-title">
            选择要添加的模型 ({filtered.length} / {props.candidates.length})
          </div>
          <button
            type="button"
            className="native-model-picker-close"
            onClick={props.onClose}
            title="关闭"
          >
            ×
          </button>
        </div>
        <div className="native-model-picker-search-row">
          <input
            type="text"
            className="native-settings-input"
            placeholder="搜索模型 ID 或名称..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={toggleAllFiltered}
          >
            {allFilteredSelected ? "取消全选" : "全选"}
          </button>
        </div>
        <div className="native-model-picker-list">
          {filtered.length === 0 ? (
            <div className="native-model-empty">无匹配模型</div>
          ) : (
            filtered.map((c) => (
              <label
                key={c.id}
                className={`native-model-picker-item ${
                  selectedIds.has(c.id) ? "selected" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleOne(c.id)}
                />
                <div className="native-model-picker-info">
                  <div className="native-model-picker-name">
                    {c.name || c.id}
                    {c.name && c.name !== c.id && (
                      <span className="native-model-id">{c.id}</span>
                    )}
                  </div>
                  {c.contextWindow && (
                    <div className="native-model-picker-meta">
                      上下文: {c.contextWindow.toLocaleString()} tokens
                    </div>
                  )}
                </div>
              </label>
            ))
          )}
        </div>
        <div className="native-model-picker-footer">
          <span className="native-model-picker-count">
            已选 {selectedIds.size} 个模型
          </span>
          <div className="native-model-picker-actions">
            <button
              type="button"
              className="native-btn native-btn-secondary"
              onClick={props.onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="native-btn native-btn-primary"
              disabled={selectedIds.size === 0}
              onClick={handleConfirm}
            >
              添加所选
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
