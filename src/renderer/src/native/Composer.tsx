import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isSupportedImage, type DraftImage } from "./images";
import { SlashMenu } from "./SlashMenu";
import {
  detectSlashTrigger,
  filterSlashCommands,
  type SlashCommandItem,
} from "./slash-commands";

interface ComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  running: boolean;
  onStop: () => void;
  textareaRef: { current: HTMLTextAreaElement | null };
  /** 工具行左侧控件（模型/强度/权限选择器）。 */
  controls?: ReactNode;
  /** 上下文占用环（贴发送按钮；无提供方用量时自身不渲染）。 */
  meter?: ReactNode;
  draftImages: DraftImage[];
  onRemoveDraftImage: (id: string) => void;
  onAddImages: (files: File[]) => void;
  onPreviewImage: (url: string) => void;
  /** 可用斜杠命令列表。 */
  commands?: SlashCommandItem[];
  /** 触发客户端特定命令（如 model）。 */
  onClientCommand?: (commandName: string) => void;
  /** 触发直接执行斜杠命令（无参数命令）。 */
  onExecuteCommand?: (line: string) => void;
}

/** 输入框高度上限，与 .native-composer-box textarea 的 max-height 一致（超出后内部滚动）。 */
const COMPOSER_MAX_HEIGHT = 200;

/**
 * 输入框随内容自适应高度：空态保持在 CSS 最小高度（两行），长文本长到上限为止。
 * 内容变化不只有键盘输入（切换会话载入草稿、发送后清空、发送失败写回都会改 value），
 * 所以按 value 统一拟合，不要只在 onChange 里调。
 */
function fitComposerHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
}

/** 卡片式输入框：textarea + 底部工具行（左侧选择器 + 圆形发送/停止按钮），空态与底部共用。 */
export function Composer({
  input,
  onInputChange,
  onSend,
  running,
  onStop,
  textareaRef,
  controls,
  meter,
  draftImages,
  onRemoveDraftImage,
  onAddImages,
  onPreviewImage,
  commands,
  onClientCommand,
  onExecuteCommand,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 监听输入，计算是否触发斜杠菜单
  const trigger = useMemo(() => {
    return detectSlashTrigger(input);
  }, [input]);

  const filteredCommands = useMemo(() => {
    if (!trigger.active || !commands || commands.length === 0) return [];
    return filterSlashCommands(commands, trigger.query);
  }, [trigger.active, trigger.query, commands]);

  const isMenuOpen =
    trigger.active && !menuDismissed && filteredCommands.length > 0;

  // 当 query 变化时，如果之前被 Esc 关闭过，重新激活菜单并将 selectedIndex 重置为 0
  useEffect(() => {
    setMenuDismissed(false);
    setSelectedIndex(0);
  }, [trigger.query]);

  // 处理命令采纳
  const handleSelectCommand = (cmd: SlashCommandItem) => {
    if (cmd.isClient) {
      setMenuDismissed(true);
      onInputChange("");
      onClientCommand?.(cmd.name);
      return;
    }

    if (cmd.hint) {
      // 需要参数的命令：补全命令名并加空格，引导用户继续输入
      const nextVal = `/${cmd.name} `;
      onInputChange(nextVal);
      setMenuDismissed(true);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextVal.length, nextVal.length);
        }
      }, 0);
      return;
    }

    // 无参数命令：直接提交执行
    setMenuDismissed(true);
    if (onExecuteCommand) {
      onExecuteCommand(`/${cmd.name}`);
    } else {
      onInputChange(`/${cmd.name}`);
      setTimeout(() => {
        onSend();
      }, 0);
    }
  };

  // textareaRef 稳定，装填新元素时也会重跑，草稿首帧即按内容展开
  useEffect(() => {
    fitComposerHeight(textareaRef.current);
  }, [input, textareaRef]);

  const canSend = !!input.trim() || draftImages.length > 0;

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
      // 阻止冒泡至全局 window.onpaste，防止单次粘贴触发两次添加
      e.stopPropagation();
      onAddImages(imageFiles);
      const text = clipboardData.getData("text/plain");
      if (!text) {
        e.preventDefault();
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
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
        onAddImages(imageFiles);
      }
    }
  };

  return (
    <div
      className="native-composer-box"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isMenuOpen && (
        <SlashMenu
          items={filteredCommands}
          selectedIndex={selectedIndex}
          onSelect={handleSelectCommand}
          onHoverIndex={setSelectedIndex}
        />
      )}
      {draftImages.length > 0 && (
        <div className="native-composer-attachments">
          {draftImages.map((img) => (
            <div key={img.id} className="native-composer-attachment-item">
              <button
                type="button"
                className="native-composer-thumb-btn"
                onClick={() => onPreviewImage(img.previewUrl)}
                title="点击预览大图"
              >
                <img src={img.previewUrl} alt="" draggable={false} />
              </button>
              <button
                type="button"
                className="native-composer-thumb-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveDraftImage(img.id);
                }}
                title="删除图片"
                aria-label="删除图片"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="10"
                  height="10"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  fill="none"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={input}
        rows={1}
        placeholder="询问任何问题（输入 / 查看斜杠命令）"
        onChange={(e) => onInputChange(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (isMenuOpen) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedIndex(
                (prev) =>
                  (prev - 1 + filteredCommands.length) %
                  filteredCommands.length,
              );
              return;
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const activeCmd = filteredCommands[selectedIndex];
              if (activeCmd) {
                handleSelectCommand(activeCmd);
              }
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMenuDismissed(true);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const activeCmd = filteredCommands[selectedIndex];
              if (activeCmd) {
                handleSelectCommand(activeCmd);
              }
              return;
            }
          }

          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            if (canSend) {
              e.preventDefault();
              onSend();
            }
          }
        }}
      />
      <div className="native-composer-bar">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAddImages(Array.from(e.target.files));
            }
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="native-composer-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="添加图片"
          aria-label="添加图片"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </button>
        {/* 控件组自身占满工具行：图片按钮与权限贴左，模型与推理档位贴右（紧邻发送按钮） */}
        {controls ?? <span style={{ flex: 1 }} />}
        {meter}
        {running && !canSend ? (
          <button className="native-send stop" onClick={onStop} title="停止">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            className="native-send"
            disabled={!canSend}
            onClick={onSend}
            // 运行中有草稿或附件时改为排队发送（与官方一致：同一位置按草稿是否可提交切换）
            title={running ? "排队发送" : "发送"}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
