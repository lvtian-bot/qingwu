import { useState } from "react";
import type { QueuedItem } from "./events";
import type { QueueAction } from "./protocol";

/**
 * 待发送队列：排队中／插话中／发送中，行内可编辑、删除、插话。
 * 条目来自引擎 inbox（agent/inbox/spliced 折出），pending 的是本地乐观回显。
 */
export function QueueStrip({
  items,
  running,
  busyId,
  onAction,
}: {
  items: QueuedItem[];
  running: boolean;
  busyId: string | null;
  onAction: (item: QueuedItem, action: QueueAction) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  if (items.length === 0) return null;

  const submitEdit = (item: QueuedItem) => {
    const text = editText.trim();
    if (text)
      onAction(item, { kind: "edit", content: [{ type: "text", text }] });
    setEditingId(null);
  };

  return (
    <div className="native-queue">
      {items.map((item) => {
        const label = item.pending
          ? "发送中"
          : item.placement === "next-step"
            ? "插话中"
            : "排队中";
        const busy = busyId === item.id;
        const editing = editingId === item.id;
        return (
          <div key={item.id} className="native-queue-row">
            <span className="native-queue-tag">{label}</span>
            {editing ? (
              <textarea
                className="native-queue-edit"
                value={editText}
                rows={2}
                autoFocus
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  } else if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    submitEdit(item);
                  }
                }}
              />
            ) : (
              <span className="native-queue-text" title={item.text}>
                {item.images && item.images.length > 0 && (
                  <span className="native-queue-img-tag">
                    [图片
                    {item.images.length > 1 ? ` × ${item.images.length}` : ""}]
                  </span>
                )}
                {item.text}
              </span>
            )}
            <span className="native-queue-actions">
              {editing ? (
                <>
                  <button
                    className="primary"
                    disabled={busy || !editText.trim()}
                    onClick={() => submitEdit(item)}
                  >
                    保存
                  </button>
                  <button onClick={() => setEditingId(null)}>取消</button>
                </>
              ) : (
                <>
                  {item.placement === "next-turn" && running && (
                    <button
                      disabled={busy || item.pending}
                      title="打断当前轮，立刻按这条执行"
                      onClick={() => onAction(item, { kind: "steer" })}
                    >
                      插话
                    </button>
                  )}
                  <button
                    disabled={busy || item.pending}
                    onClick={() => {
                      setEditingId(item.id);
                      setEditText(item.text);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    disabled={busy || item.pending}
                    onClick={() => onAction(item, { kind: "remove" })}
                  >
                    删除
                  </button>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
