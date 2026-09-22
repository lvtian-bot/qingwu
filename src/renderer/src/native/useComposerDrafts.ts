/**
 * 输入草稿管理：逐会话文本/图片草稿桶（仅内存）+ 草稿图片的添加/删除、
 * 全局粘贴与拖放接入。切换会话时切走保留、切回恢复，避免把 A 里没写完的
 * 半句话发到 B。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, RefObject } from "react";
import {
  fileToBase64,
  getImageMediaType,
  isSupportedImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type DraftImage,
} from "./images";

interface ComposerDraftsOptions {
  /** 当前会话 id 的最新值（异步回调里取归属桶）。 */
  currentIdRef: RefObject<string | null>;
  setError: (message: string | null) => void;
}

interface DraftVersion {
  key: string;
  revision: number;
}

export function useComposerDrafts({
  currentIdRef,
  setError,
}: ComposerDraftsOptions) {
  const [input, setInput] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  /**
   * 逐会话草稿桶：键为会话 id，无会话时用空串。写入走 handleInputChange，
   * 读取走切换会话时的 loadForSession。
   */
  const composerDraftsRef = useRef<Map<string, string>>(new Map());
  const composerImagesRef = useRef<Map<string, DraftImage[]>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const revisionsRef = useRef(new Map<string, number>());
  const touch = useCallback((key: string): DraftVersion => {
    const revision = (revisionsRef.current.get(key) ?? 0) + 1;
    revisionsRef.current.set(key, revision);
    return { key, revision };
  }, []);
  const captureForSubmit = useCallback(
    (sessionId: string | null): DraftVersion => {
      const key = sessionId ?? "";
      return { key, revision: revisionsRef.current.get(key) ?? 0 };
    },
    [],
  );

  /**
   * 输入变化：立即把内容写进当前会话的草稿桶（无会话时用空串键），
   * 这样切换会话时无需在 effect 里回头保存上一个会话的内容。
   */
  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      const key = currentIdRef.current ?? "";
      touch(key);
      if (value) composerDraftsRef.current.set(key, value);
      else composerDraftsRef.current.delete(key);
    },
    [currentIdRef, touch],
  );

  const handleAddImages = useCallback(
    (files: File[]) => {
      const valid: File[] = [];
      for (const f of files) {
        if (!isSupportedImage(f)) {
          setError(`不支持的图片格式: ${f.name}。仅支持 PNG、JPEG、WebP、GIF`);
          continue;
        }
        if (f.size > MAX_IMAGE_BYTES) {
          setError(`图片 ${f.name} 超过 20MB 上限`);
          continue;
        }
        valid.push(f);
      }
      if (valid.length === 0) return;

      const key = currentIdRef.current ?? "";
      const prev = composerImagesRef.current.get(key) ?? [];
      if (prev.length + valid.length > MAX_IMAGES_PER_MESSAGE) {
        setError(`单条消息最多添加 ${MAX_IMAGES_PER_MESSAGE} 张图片`);
        return;
      }
      const newItems: DraftImage[] = valid.map((file) => {
        const id = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        const mediaType = getImageMediaType(file);
        const name = file.name || `image-${Date.now()}.png`;
        const item: DraftImage = {
          id,
          file,
          previewUrl,
          mediaType,
          name,
        };
        fileToBase64(file)
          .then((b64) => {
            item.base64 = b64;
            const dataUrl = `data:${mediaType};base64,${b64}`;
            item.previewUrl = dataUrl;
            setDraftImages((cur) =>
              cur.map((d) =>
                d.id === id ? { ...d, base64: b64, previewUrl: dataUrl } : d,
              ),
            );
          })
          .catch(() => {});
        return item;
      });
      const next = [...prev, ...newItems];
      touch(key);
      composerImagesRef.current.set(key, next);
      setDraftImages(next);
    },
    [currentIdRef, setError, touch],
  );

  const handleRemoveDraftImage = useCallback(
    (id: string) => {
      const key = currentIdRef.current ?? "";
      const prev = composerImagesRef.current.get(key) ?? [];
      const target = prev.find((img) => img.id === id);
      if (target?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const next = prev.filter((img) => img.id !== id);
      touch(key);
      if (next.length > 0) composerImagesRef.current.set(key, next);
      else composerImagesRef.current.delete(key);
      setDraftImages(next);
    },
    [currentIdRef, touch],
  );

  // 全局剪贴板粘贴监听：未聚焦输入框时粘贴图片也自动加入当前草稿并聚焦
  useEffect(() => {
    const onGlobalPaste = (e: ClipboardEvent) => {
      // 只要光标在任何输入元素（包括主输入框），都由该元素自身的 onPaste 独立处理，此处直接跳过
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;
      const imageFiles: File[] = [];
      if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          const file = clipboardData.files[i];
          if (isSupportedImage(file)) imageFiles.push(file);
        }
      } else if (clipboardData.items) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file && isSupportedImage(file)) imageFiles.push(file);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleAddImages(imageFiles);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("paste", onGlobalPaste);
    return () => window.removeEventListener("paste", onGlobalPaste);
  }, [handleAddImages]);

  const handleChatDragOver = (e: ReactDragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleChatDrop = (e: ReactDragEvent) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const imageFiles: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (isSupportedImage(file)) {
          imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleAddImages(imageFiles);
        textareaRef.current?.focus();
      }
    }
  };

  /** 只清理此次提交读取的草稿；创建会话期间的新编辑不受影响。 */
  const clearForSubmit = useCallback(
    (
      sessionId: string | null,
      source = captureForSubmit(sessionId),
    ): DraftVersion | null => {
      if ((revisionsRef.current.get(source.key) ?? 0) !== source.revision)
        return null;
      composerDraftsRef.current.delete(source.key);
      composerImagesRef.current.delete(source.key);
      touch(source.key);
      const key = sessionId ?? "";
      // 从空白页进入已有空会话时，保留目标会话原有的未发送草稿。
      const targetHasDraft =
        key !== source.key &&
        (composerDraftsRef.current.has(key) ||
          (composerImagesRef.current.get(key)?.length ?? 0) > 0);
      const activeKey = currentIdRef.current ?? "";
      if (activeKey === source.key || (activeKey === key && !targetHasDraft)) {
        setInput("");
        setDraftImages([]);
      }
      return targetHasDraft ? null : touch(key);
    },
    [captureForSubmit, currentIdRef, touch],
  );

  /** 「/model」类本地命令：只清文本输入与文本草稿桶，不动图片。 */
  const clearTextDraft = useCallback(
    (sessionId: string | null) => {
      setInput("");
      composerDraftsRef.current.delete(sessionId ?? "");
      touch(sessionId ?? "");
    },
    [touch],
  );

  /** 失败仅恢复未被再次编辑的归属桶；切到别的会话时不改当前输入。 */
  const restoreAfterFailure = useCallback(
    (version: DraftVersion | null, text: string, images: DraftImage[]) => {
      if (
        !version ||
        revisionsRef.current.get(version.key) !== version.revision
      )
        return;
      composerDraftsRef.current.set(version.key, text);
      composerImagesRef.current.set(version.key, images);
      touch(version.key);
      if ((currentIdRef.current ?? "") === version.key) {
        setInput(text);
        setDraftImages(images);
      }
    },
    [currentIdRef, touch],
  );

  /** 切换会话：载入目标会话自己的草稿（上一个会话的草稿已在输入时写进各自的桶）。 */
  const loadForSession = useCallback((sessionId: string | null) => {
    setInput(composerDraftsRef.current.get(sessionId ?? "") ?? "");
    setDraftImages(composerImagesRef.current.get(sessionId ?? "") ?? []);
  }, []);

  /** 草稿随人迁移（换工作区落点时旧会话草稿转到新会话，旧桶清空）。 */
  const migrateBuckets = useCallback(
    (fromId: string, toId: string) => {
      touch(fromId);
      touch(toId);
      const pending = composerDraftsRef.current.get(fromId);
      if (pending !== undefined) {
        composerDraftsRef.current.set(toId, pending);
        composerDraftsRef.current.delete(fromId);
      }
      const pendingImgs = composerImagesRef.current.get(fromId);
      if (pendingImgs !== undefined) {
        composerImagesRef.current.set(toId, pendingImgs);
        composerImagesRef.current.delete(fromId);
      }
    },
    [touch],
  );

  /** 会话已删除：草稿桶与图片一并清理（内存态，避免残留）。 */
  const discardFor = useCallback(
    (sessionId: string) => {
      touch(sessionId);
      composerDraftsRef.current.delete(sessionId);
      composerImagesRef.current.delete(sessionId);
    },
    [touch],
  );

  return {
    input,
    draftImages,
    textareaRef,
    handleInputChange,
    handleAddImages,
    handleRemoveDraftImage,
    handleChatDragOver,
    handleChatDrop,
    clearForSubmit,
    captureForSubmit,
    clearTextDraft,
    restoreAfterFailure,
    loadForSession,
    migrateBuckets,
    discardFor,
  };
}

/** 草稿管理控制器：输入态、逐会话草稿桶操作与图片附件接入。 */
export type ComposerDraftsApi = ReturnType<typeof useComposerDrafts>;
