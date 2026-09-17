import { useEffect, useState } from "react";
import { Endpoints, type SessionAttachmentResult } from "./protocol";
import { rpc } from "./rpc";

/** 草稿中附加的图片项。 */
export interface DraftImage {
  id: string;
  file: File;
  previewUrl: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  name: string;
  base64?: string;
}

/** 消息（用户或队列）中展示的图片项。 */
export interface MessageImageItem {
  id?: string;
  url?: string;
  attachmentId?: string;
  mediaType?: string;
  name?: string;
  width?: number;
  height?: number;
}

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const MAX_IMAGES_PER_MESSAGE = 20;

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// 20MB

export function isSupportedImage(file: File): boolean {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return (
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "webp" ||
    ext === "gif"
  );
}

export function getImageMediaType(
  file: File,
): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  if (file.type === "image/png") return "image/png";
  if (file.type === "image/jpeg" || file.type === "image/jpg")
    return "image/jpeg";
  if (file.type === "image/webp") return "image/webp";
  if (file.type === "image/gif") return "image/gif";
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(",");
      resolve(commaIndex !== -1 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function base64ToBlobUrl(base64: string, mediaType: string): string {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mediaType }));
  } catch {
    return `data:${mediaType};base64,${base64}`;
  }
}

/** 缓存已加载的持久化图片 Blob URL，避免重复调用 RPC */
const attachmentUrlCache = new Map<string, string>();

/** 消息内图片展示项：支持 blob 预览 URL 与宿主 attachmentId 按需异步加载。 */
export function MessageImageView({
  image,
  sessionId,
  onPreview,
}: {
  image: MessageImageItem;
  sessionId?: string | null;
  onPreview?: (url: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(image.url ?? null);
  const [loading, setLoading] = useState(!image.url && !!image.attachmentId);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (image.url) {
      setSrc(image.url);
      setLoading(false);
      return;
    }
    if (!image.attachmentId || !sessionId) return;

    const cacheKey = `${sessionId}:${image.attachmentId}`;
    const cached = attachmentUrlCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(false);

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
        attachmentUrlCache.set(cacheKey, blobUrl);
        setSrc(blobUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [image.url, image.attachmentId, sessionId]);

  if (error) {
    return (
      <div className="native-msg-image-error" title="图片加载失败">
        <span>图片加载失败</span>
      </div>
    );
  }

  if (loading || !src) {
    return (
      <div className="native-msg-image-loading" title="图片加载中...">
        <div className="native-spinner" />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="native-msg-image-btn"
      onClick={() => onPreview?.(src)}
      title="点击查看原图"
    >
      <img src={src} alt="" draggable={false} />
    </button>
  );
}

/** 大图灯箱预览模态框。 */
export function LightboxModal({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="native-lightbox-overlay" onClick={onClose}>
      <div
        className="native-lightbox-content"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt="图片预览" />
        <button
          type="button"
          className="native-lightbox-close"
          onClick={onClose}
          title="关闭 (Esc)"
          aria-label="关闭预览"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
