import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";

/**
 * 用户级指令分区：编辑 ~/.dsh/AGENTS.md（主进程直读直写，不依赖引擎在线）。
 * 手动保存，草稿保留在分区挂载内；引擎在会话创建时读取该文件，
 * 保存后新会话生效。
 */

/** 编辑框自动增高的封顶高度：超出后转入框内滚动，避免把设置页拉得过长。 */
const TEXTAREA_MAX_HEIGHT = 760;

export function InstructionsTab({ visible }: { visible: boolean }) {
  const t = useT();
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [maxBytes, setMaxBytes] = useState(64 * 1024);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const snapshot = await window.qingwu.getUserInstructions();
        setContent(snapshot.content);
        setSavedContent(snapshot.content);
        setMaxBytes(snapshot.maxBytes);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const bytes = useMemo(
    () => new TextEncoder().encode(content).length,
    [content],
  );
  const overLimit = bytes > maxBytes;
  const dirty = content !== savedContent;

  // 编辑框随内容自动增高（封顶后框内滚动），避免小框里翻长文；
  // 面板 display:none 时测量无效，切入分区可见时重新测量
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!visible) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [content, loading, visible]);

  const handleSave = async () => {
    if (overLimit || saving || loading) return;
    setSaving(true);
    setSaveError(null);
    try {
      const snapshot = await window.qingwu.saveUserInstructions(content);
      setSavedContent(snapshot.content);
      setMaxBytes(snapshot.maxBytes);
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  const formatKb = (value: number) => {
    const kb = value / 1024;
    return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  };

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.instructions.title")}</h2>
        <p>
          <span title={t("settings.instructions.badgeTitle")}>
            {t("settings.instructions.badge")}
          </span>
          {t("settings.instructions.desc")}
        </p>
      </div>

      <div className="native-settings-card native-settings-instructions">
        {loadError ? (
          <div className="native-settings-instructions-error" role="alert">
            {`${t("settings.instructions.loadFailed", {
              message: loadError,
            })}`}
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              className="native-settings-textarea"
              value={content}
              placeholder={t("settings.instructions.placeholder")}
              disabled={loading}
              spellCheck={false}
              onChange={(e) => {
                setContent(e.target.value);
                setSaved(false);
              }}
            />
            <div className="native-settings-instructions-footer">
              <span
                className={`native-settings-usage${overLimit ? " over" : ""}`}
              >
                {overLimit
                  ? t("settings.instructions.overLimit")
                  : t("settings.instructions.usage", {
                      used: formatKb(bytes),
                      total: formatKb(maxBytes),
                    })}
              </span>
              <button
                type="button"
                className="native-btn"
                disabled={loading || saving || overLimit || !dirty}
                onClick={() => void handleSave()}
              >
                {saving
                  ? t("settings.instructions.saving")
                  : t("settings.instructions.save")}
              </button>
            </div>
            {saveError && (
              <div className="native-settings-instructions-error" role="alert">
                {t("settings.instructions.saveFailed", { message: saveError })}
              </div>
            )}
            {saved && !saveError && (
              <div className="native-settings-instructions-saved" role="status">
                {t("settings.instructions.saved")}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
