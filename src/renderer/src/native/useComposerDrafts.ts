/**
 * 输入草稿管理：逐会话文本/图片草稿桶（仅内存）+ 草稿图片的添加/删除、
 * 全局粘贴与拖放接入。切换会话时切走保留、切回恢复，避免把 A 里没写完的
 * 半句话发到 B。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, RefObject } from "react";
import { useT } from "../i18n";
import {
  fileToBase64,
  getImageMediaType,
  isSupportedImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type DraftImage,
} from "./images";
import { formatFileMentionFromPath } from "./file-mentions";

interface ComposerDraftsOptions {
  /** 当前会话 id 的最新值（异步回调里取归属桶）。 */
  currentIdRef: RefObject<string | null>;
  /** 当前会话工作目录（文件转 @ 引用时的相对基准）。 */
  currentCwdRef?: RefObject<string | null | undefined>;
  setError: (message: string | null) => void;
}

interface DraftVersion {
  key: string;
  revision: number;
}

export function useComposerDrafts({
  currentIdRef,
  currentCwdRef,
  setError,
}: ComposerDraftsOptions) {
  const t = useT();
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
  /** 记录草稿提交清空/废弃的世代号，仅在草稿被发送或删除时递增，普通打字不改变它 */
  const clearGenerationsRef = useRef(new Map<string, number>());
  const bumpClearGeneration = useCallback((key: string) => {
    const nextGen = (clearGenerationsRef.current.get(key) ?? 0) + 1;
    clearGenerationsRef.current.set(key, nextGen);
    return nextGen;
  }, []);
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
    (files: File[], targetSessionId?: string | null) => {
      const valid: File[] = [];
      for (const f of files) {
        if (!isSupportedImage(f)) {
          setError(t("composer.unsupportedImageType", { name: f.name }));
          continue;
        }
        if (f.size > MAX_IMAGE_BYTES) {
          setError(t("composer.imageTooLarge", { name: f.name }));
          continue;
        }
        valid.push(f);
      }
      if (valid.length === 0) return;

      const key = (targetSessionId !== undefined ? targetSessionId : currentIdRef.current) ?? "";
      const prev = composerImagesRef.current.get(key) ?? [];
      if (prev.length + valid.length > MAX_IMAGES_PER_MESSAGE) {
        setError(t("composer.tooManyImages", { count: MAX_IMAGES_PER_MESSAGE }));
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
            // 更新对应会话桶中的 draftImage 项
            const bucketImgs = composerImagesRef.current.get(key);
            if (bucketImgs) {
              const updated = bucketImgs.map((d) =>
                d.id === id ? { ...d, base64: b64, previewUrl: dataUrl } : d,
              );
              composerImagesRef.current.set(key, updated);
            }
            if ((currentIdRef.current ?? "") === key) {
              setDraftImages((cur) =>
                cur.map((d) =>
                  d.id === id ? { ...d, base64: b64, previewUrl: dataUrl } : d,
                ),
              );
            }
          })
          // 图片读取失败时上横幅提示（文案走词条，中文与 images.tsx 内原错误文案一致）
          .catch(() => {
            setError(t("composer.imageReadFailed"));
          });
        return item;
      });
      const next = [...prev, ...newItems];
      touch(key);
      composerImagesRef.current.set(key, next);
      if ((currentIdRef.current ?? "") === key) {
        setDraftImages(next);
      }
    },
    [currentIdRef, setError, touch, t],
  );

  /**
   * 将选中的外部文件分流处理：
   * - 支持的图片文件：加入草稿图片附件（最多 MAX_IMAGES_PER_MESSAGE 张）；
   * - 非图片文件（或目录）：提取本地路径并按相对当前会话工作区（cwd）转换为 @ 引用追加到输入框。
   */
  const handleAddFiles = useCallback(
    (
      files: File[],
      directories?: Set<File>,
      rawEntries?: Array<{ path: string; isDirectory: boolean; isImage: boolean }>,
      targetCwd?: string | null,
      targetSessionId?: string | null,
    ) => {
      if ((!files || files.length === 0) && (!rawEntries || rawEntries.length === 0)) return;
      const key = (targetSessionId !== undefined ? targetSessionId : currentIdRef.current) ?? "";
      const images: File[] = [];
      const mentions: string[] = [];
      const cwd = targetCwd !== undefined ? targetCwd : currentCwdRef?.current;

      for (const f of files || []) {
        const isDir = directories ? directories.has(f) : false;
        if (!isDir && isSupportedImage(f)) {
          images.push(f);
        } else {
          // 通过 window.qingwu.getPathForFile 获取 Electron webUtils 提供的本地绝对路径
          const filePath =
            window.qingwu?.getPathForFile?.(f) ||
            (f as { path?: string }).path ||
            '';
          if (filePath) {
            const formatted = formatFileMentionFromPath(filePath, cwd, isDir);
            if (formatted) {
              mentions.push(formatted);
            }
          } else {
            setError(t("composer.attachmentPathUnavailable"));
          }
        }
      }

      if (rawEntries && rawEntries.length > 0) {
        const imageEntries: Array<{ path: string; isDirectory: boolean; isImage: boolean }> = [];
        for (const entry of rawEntries) {
          if (entry.isImage) {
            imageEntries.push(entry);
          } else {
            const formatted = formatFileMentionFromPath(entry.path, cwd, entry.isDirectory);
            if (formatted) {
              mentions.push(formatted);
            }
          }
        }

        if (imageEntries.length > 0) {
          const expectedClearGen = clearGenerationsRef.current.get(key) ?? 0;
          Promise.all(
            imageEntries.map(async (entry) => {
              if (!window.qingwu?.readLocalImage) {
                return { kind: "fallback", path: entry.path } as const;
              }
              const res = await window.qingwu.readLocalImage(entry.path);
              if (!res) {
                // 超限(>20MB)或读取失败：不吞掉，降级为插入 @ 路径引用并报错提示
                return { kind: "fallback", path: entry.path, reason: "tooLarge" } as const;
              }
              const name = entry.path.split(/[\\/]/).pop() || "image.png";
              const r = await fetch(res.dataUrl);
              const blob = await r.blob();
              const file = new File([blob], name, { type: res.mimeType });
              return { kind: "file", file } as const;
            }),
          )
            .then((results) => {
              // 仅当草稿已被提交发送或销毁（clearGeneration已变动）时丢弃；用户普通打字或追加文本不影响图片正常追加
              const currentClearGen = clearGenerationsRef.current.get(key) ?? 0;
              if (currentClearGen !== expectedClearGen) return;

              const validFiles: File[] = [];
              const fallbackMentions: string[] = [];
              for (const item of results) {
                if (item.kind === "file") {
                  validFiles.push(item.file);
                } else {
                  if (item.reason === "tooLarge") {
                    setError(t("composer.imageTooLarge", { name: item.path.split(/[\\/]/).pop() || item.path }));
                  }
                  const formatted = formatFileMentionFromPath(item.path, cwd, false);
                  if (formatted) fallbackMentions.push(formatted);
                }
              }

              if (validFiles.length > 0) {
                handleAddImages(validFiles, key);
              }

              if (fallbackMentions.length > 0) {
                const prevText = composerDraftsRef.current.get(key) ?? ((currentIdRef.current ?? "") === key ? input : "");
                const insertText = fallbackMentions.join(" ");
                const nextText = prevText
                  ? prevText.endsWith(" ") || prevText.endsWith("\n")
                    ? `${prevText}${insertText} `
                    : `${prevText} ${insertText} `
                  : `${insertText} `;
                touch(key);
                composerDraftsRef.current.set(key, nextText);
                if ((currentIdRef.current ?? "") === key) {
                  setInput(nextText);
                  setTimeout(() => {
                    if (textareaRef.current) {
                      textareaRef.current.focus();
                      const len = nextText.length;
                      textareaRef.current.setSelectionRange(len, len);
                    }
                  }, 0);
                }
              }
            })
            .catch(() => {});
        }
      }

      if (images.length > 0) {
        handleAddImages(images, key);
      }

      if (mentions.length > 0) {
        const prevText = composerDraftsRef.current.get(key) ?? ((currentIdRef.current ?? "") === key ? input : "");
        const insertText = mentions.join(" ");
        const nextText = prevText
          ? prevText.endsWith(" ") || prevText.endsWith("\n")
            ? `${prevText}${insertText} `
            : `${prevText} ${insertText} `
          : `${insertText} `;
        touch(key);
        composerDraftsRef.current.set(key, nextText);
        if ((currentIdRef.current ?? "") === key) {
          setInput(nextText);
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus();
              const len = nextText.length;
              textareaRef.current.setSelectionRange(len, len);
            }
          }, 0);
        }
      }
    },
    [currentCwdRef, currentIdRef, handleAddImages, input, setError, t, touch],
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

  // 全局剪贴板粘贴监听：未聚焦输入框时粘贴图片或文件也自动分流加入当前草稿并聚焦
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
      const files: File[] = [];
      const directories = new Set<File>();
      if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          files.push(clipboardData.files[i]);
        }
      }
      if (clipboardData.items) {
        const hadFiles = files.length > 0;
        let fileIdx = 0;
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
              if (!hadFiles) {
                files.push(file);
              }
              const f = hadFiles ? files[fileIdx++] : file;
              if (
                f &&
                typeof item.webkitGetAsEntry === "function" &&
                item.webkitGetAsEntry()?.isDirectory === true
              ) {
                directories.add(f);
              }
            }
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleAddFiles(files, directories);
        textareaRef.current?.focus();
      } else if (window.qingwu?.readClipboardFilePaths) {
        // 记录触发时的会话 id 与 cwd，防止异步返回时已切换会话
        const capturedSessionId = currentIdRef.current;
        const capturedCwd = currentCwdRef?.current;
        window.qingwu.readClipboardFilePaths().then((entries) => {
          if (entries && entries.length > 0) {
            handleAddFiles([], undefined, entries, capturedCwd, capturedSessionId);
            if (currentIdRef.current === capturedSessionId) {
              textareaRef.current?.focus();
            }
          }
        });
      }
    };
    window.addEventListener("paste", onGlobalPaste);
    return () => window.removeEventListener("paste", onGlobalPaste);
  }, [handleAddFiles]);

  const handleChatDragOver = (e: ReactDragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleChatDrop = (e: ReactDragEvent) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      const directories = new Set<File>();
      let fileIdx = 0;
      if (e.dataTransfer.items) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i];
          if (item.kind !== "file") continue;
          const f = files[fileIdx++];
          if (
            typeof item.webkitGetAsEntry === "function" &&
            item.webkitGetAsEntry()?.isDirectory === true &&
            f !== undefined
          ) {
            directories.add(f);
          }
        }
      }
      handleAddFiles(files, directories);
      textareaRef.current?.focus();
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
      bumpClearGeneration(source.key);
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
    [bumpClearGeneration, captureForSubmit, currentIdRef, touch],
  );

  /** 「/model」类本地命令：只清文本输入与文本草稿桶，不动图片。 */
  const clearTextDraft = useCallback(
    (sessionId: string | null) => {
      const key = sessionId ?? "";
      setInput("");
      composerDraftsRef.current.delete(key);
      touch(key);
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

  /** 会话已删除：草稿桶与图片一并清理（内存态，避免残留）。 */
  const discardFor = useCallback(
    (sessionId: string) => {
      bumpClearGeneration(sessionId);
      touch(sessionId);
      composerDraftsRef.current.delete(sessionId);
      composerImagesRef.current.delete(sessionId);
    },
    [bumpClearGeneration, touch],
  );

  /** 处理输入框自身的 onPaste 事件：提取文件或通过 Electron 剪贴板提取路径，支持切换会话安全与目录识别 */
  const handleComposerPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;
      const files: File[] = [];
      const directories = new Set<File>();
      if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          files.push(clipboardData.files[i]);
        }
      }
      if (clipboardData.items) {
        const hadFiles = files.length > 0;
        let fileIdx = 0;
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
              if (!hadFiles) {
                files.push(file);
              }
              const f = hadFiles ? files[fileIdx++] : file;
              if (
                f &&
                typeof item.webkitGetAsEntry === "function" &&
                item.webkitGetAsEntry()?.isDirectory === true
              ) {
                directories.add(f);
              }
            }
          }
        }
      }
      if (files.length > 0) {
        e.stopPropagation();
        handleAddFiles(files, directories);
        const text = clipboardData.getData("text/plain");
        if (!text) {
          e.preventDefault();
        }
      } else if (window.qingwu?.readClipboardFilePaths) {
        const capturedSessionId = currentIdRef.current;
        const capturedCwd = currentCwdRef?.current;
        window.qingwu.readClipboardFilePaths().then((entries) => {
          if (entries && entries.length > 0) {
            handleAddFiles([], undefined, entries, capturedCwd, capturedSessionId);
            if (currentIdRef.current === capturedSessionId) {
              textareaRef.current?.focus();
            }
          }
        });
      }
    },
    [currentCwdRef, currentIdRef, handleAddFiles],
  );

  return {
    input,
    draftImages,
    textareaRef,
    handleInputChange,
    handleAddImages,
    handleAddFiles,
    handleRemoveDraftImage,
    handleComposerPaste,
    handleChatDragOver,
    handleChatDrop,
    clearForSubmit,
    captureForSubmit,
    clearTextDraft,
    restoreAfterFailure,
    loadForSession,
    discardFor,
  };
}

/** 草稿管理控制器：输入态、逐会话草稿桶操作与图片附件接入。 */
export type ComposerDraftsApi = ReturnType<typeof useComposerDrafts>;
