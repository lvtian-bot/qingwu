import { useEffect, useState } from "react";
import { useT } from "../i18n";

/**
 * 会话页标题面包屑：「项目 / 会话名」。
 * 项目部分点击即在该项目下新建会话，与会话列表的项目行「新建会话」同义；
 * 会话名点击原地改名，回车或失焦保存、Esc 取消。
 */
export function ChatTitle({
  projectTitle,
  title,
  onNewSessionInProject,
  onRename,
}: {
  projectTitle: string | null;
  title: string;
  onNewSessionInProject?: () => void;
  onRename: (title: string) => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);

  // 标题被外部更新（重命名回填、引擎推送）时同步草稿，避免下次编辑带回旧值
  useEffect(() => {
    if (!renaming) setDraftTitle(title);
  }, [title, renaming]);

  const commitRename = () => {
    const next = draftTitle.trim();
    setRenaming(false);
    if (next && next !== title) onRename(next);
    else setDraftTitle(title);
  };

  return (
    <div className="native-chat-title">
      {projectTitle && onNewSessionInProject && (
        <>
          <button
            type="button"
            className="native-chat-project"
            onClick={onNewSessionInProject}
            title={t("sidebar.workspace.newChatAria", { name: projectTitle })}
            aria-label={t("sidebar.workspace.newChatAria", {
              name: projectTitle,
            })}
          >
            {projectTitle}
          </button>
          <span className="native-chat-title-sep" aria-hidden="true">
            /
          </span>
        </>
      )}
      {renaming ? (
        <input
          className="native-chat-title-rename"
          value={draftTitle}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
            if (e.key === "Escape") {
              setDraftTitle(title);
              setRenaming(false);
            }
          }}
          onBlur={commitRename}
          aria-label={t("sidebar.session.renameAria")}
        />
      ) : (
        <button
          type="button"
          className="native-chat-session-title"
          onClick={() => setRenaming(true)}
          title={t("chat.header.renameHint")}
        >
          {title}
        </button>
      )}
    </div>
  );
}
