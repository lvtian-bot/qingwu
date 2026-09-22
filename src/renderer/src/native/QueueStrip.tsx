import { useEffect, useState } from "react";
import type { QueuedItem } from "./events";
import { Endpoints, type QueueAction, type SessionAttachmentResult } from "./protocol";
import { base64ToBlobUrl, type MessageImageItem } from "./images";
import { rpc } from "./rpc";
import {
  QueueBubbleIcon,
  QueueCheckIcon,
  QueueCloseIcon,
  QueueEditIcon,
  QueueSteerIcon,
  QueueTrashIcon,
} from "./native-icons";

/** 缩略图缓存 */
const queueThumbCache = new Map<string, string>();

function QueueImageThumb({
  image,
  sessionId,
}: {
  image: MessageImageItem;
  sessionId?: string | null;
}) {
  const [src, setSrc] = useState<string | null>(image.url ?? null);

  useEffect(() => {
    if (image.url) {
      setSrc(image.url);
      return;
    }
    if (!image.attachmentId || !sessionId) return;
    const cacheKey = `${sessionId}:${image.attachmentId}`;
    const cached = queueThumbCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }

    let active = true;
    rpc<SessionAttachmentResult>(Endpoints.sessionAttachment, {
      request: {
        sessionId,
        attachmentId: image.attachmentId,
      },
    })
      .then((res) => {
        if (!active) return;
        const blobUrl = base64ToBlobUrl(
          res.data,
          res.attachment?.mediaType || "image/png",
        );
        queueThumbCache.set(cacheKey, blobUrl);
        setSrc(blobUrl);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [image.url, image.attachmentId, sessionId]);

  if (!src) return <span className="native-queue-thumb-placeholder" />;
  return (
    <img
      src={src}
      alt="排队附件"
      className="native-queue-thumb"
      draggable={false}
    />
  );
}

/**
 * 待发送队列条（对齐官方 QueueDock 卡片化交互与视觉图标）：
 * - 左侧：对话气泡图标 + 图片缩略图 + 消息文本预览
 * - 右侧操作区：编辑（铅笔）、删除（垃圾桶）、插话发送（向上箭头）
 */
export function QueueStrip({
  items,
  running,
  busyId,
  sessionId,
  onAction,
}: {
  items: QueuedItem[];
  running: boolean;
  busyId: string | null;
  sessionId?: string | null;
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
    <div className="native-queue" data-queue-dock="">
      {items.map((item) => {
        const busy = busyId === item.id;
        const editing = editingId === item.id;
        const isNextStep = item.placement === "next-step";

        return (
          <div key={item.id} className="native-queue-row">
            <span
              className="native-queue-lead"
              title={item.pending ? "发送中" : isNextStep ? "插话中" : "排队中"}
            >
              <QueueBubbleIcon />
            </span>

            {editing ? (
              <input
                className="native-queue-editor"
                value={editText}
                autoFocus
                placeholder="编辑消息正文"
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
              <>
                {item.images && item.images.length > 0 && (
                  <span className="native-queue-attachments">
                    {item.images.map((img, idx) => (
                      <QueueImageThumb
                        key={img.id || img.attachmentId || idx}
                        image={img}
                        sessionId={sessionId}
                      />
                    ))}
                  </span>
                )}
                <span className="native-queue-text" title={item.text}>
                  {item.text || "(无文本内容)"}
                  {item.pending && (
                    <span className="native-queue-status">（发送中…）</span>
                  )}
                  {!item.pending && isNextStep && (
                    <span className="native-queue-status">（插话中）</span>
                  )}
                </span>
              </>
            )}

            <div className="native-queue-actions">
              {editing ? (
                <>
                  <button
                    type="button"
                    className="native-queue-action-btn"
                    disabled={busy || !editText.trim()}
                    title="保存排队消息 (Enter)"
                    aria-label="保存排队消息"
                    onClick={() => submitEdit(item)}
                  >
                    <QueueCheckIcon />
                  </button>
                  <button
                    type="button"
                    className="native-queue-action-btn"
                    disabled={busy}
                    title="取消编辑 (Esc)"
                    aria-label="取消编辑"
                    onClick={() => setEditingId(null)}
                  >
                    <QueueCloseIcon />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="native-queue-action-btn"
                    disabled={busy || item.pending}
                    title="编辑排队消息"
                    aria-label="编辑排队消息"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditText(item.text);
                    }}
                  >
                    <QueueEditIcon />
                  </button>
                  <button
                    type="button"
                    className="native-queue-action-btn"
                    disabled={busy || item.pending}
                    title="删除排队消息"
                    aria-label="删除排队消息"
                    onClick={() => onAction(item, { kind: "remove" })}
                  >
                    <QueueTrashIcon />
                  </button>
                  {item.placement === "next-turn" && running && (
                    <button
                      type="button"
                      className="native-queue-action-btn"
                      disabled={busy || item.pending}
                      title="插话发送（打断当前轮，立刻按这条执行）"
                      aria-label="插话发送"
                      onClick={() => onAction(item, { kind: "steer" })}
                    >
                      <QueueSteerIcon />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
