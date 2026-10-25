import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SkillDisplayInfo,
  SkillFolderGroup,
  SkillsSnapshot,
} from "../../../shared/types";
import type { WorkspaceView } from "./protocol";
import { useT } from "../i18n";

/** listLocalSkills 的工作区入参（与 shared/types QingwuApi 声明一致）。 */
type WorkspaceRef = { workspaceId: string; title: string; path: string };

export interface SkillsTabProps {
  /** 工作区快照：项目级技能按工作区路径扫描其技能目录。 */
  workspaces?: WorkspaceView[];
  /** 所在分区当前是否可见：切入分区时刷新列表。 */
  visible: boolean;
}

/** 技能来源 Tab：两个用户级文件夹固定在前，已打开项目按顺序跟随。 */
type SkillTabId = string;

/** 技能分区：按技能来源 Tab 切换展示，主进程目录视图，不依赖引擎在线。 */
export function SkillsTab({ workspaces, visible }: SkillsTabProps) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<SkillsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SkillTabId>("user-agents");

  // 工作区快照引用频繁变化，读取时取最新值即可，不作为刷新触发条件
  const workspacesRef = useRef<WorkspaceRef[]>([]);
  workspacesRef.current = (workspaces ?? []).map((workspace) => ({
    workspaceId: workspace.workspaceId,
    title: workspace.title,
    path: workspace.path,
  }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await window.qingwu.listLocalSkills(workspacesRef.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载不加载；切入分区时读取/刷新
  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const handleOpenFolder = () => {
    void window.qingwu.openSkillsFolder();
  };

  // 空技能的来源不出 Tab：用户级按文件夹过滤，项目按两个文件夹合计过滤
  const tabs: { id: SkillTabId; label: string }[] = snapshot
    ? [
        ...(snapshot.user[0]?.skills.length
          ? [{ id: "user-agents", label: t("settings.skills.tabPersonal") }]
          : []),
        ...(snapshot.user[1]?.skills.length
          ? [{ id: "user-dsh", label: t("settings.skills.tabQingwu") }]
          : []),
        ...snapshot.projects
          .filter((project) =>
            project.folders.some((folder) => folder.skills.length > 0),
          )
          .map((project) => ({
            id: `project:${project.workspaceId}`,
            label: project.title,
          })),
      ]
    : [];
  const currentId = tabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : tabs[0]?.id;

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.skills.title")}</h2>
        <p>{t("settings.skills.desc")}</p>
      </div>

      <div className="native-settings-skill-tabbar">
        <div className="native-settings-skill-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === currentId}
              className={`native-settings-skill-tab${
                tab.id === currentId ? " active" : ""
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="native-settings-toolbar">
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={handleOpenFolder}
          >
            {t("settings.skills.openFolder")}
          </button>
          <button
            type="button"
            className="native-btn native-btn-secondary"
            disabled={loading}
            onClick={() => void load()}
            title={t("settings.skills.refresh")}
          >
            {t("settings.skills.refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div className="native-settings-skills-error" role="alert">
          <span>
            {t("settings.skills.loadFailed")}
            {error ? `: ${error}` : ""}
          </span>
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={() => void load()}
          >
            {t("settings.skills.retry")}
          </button>
        </div>
      )}

      {snapshot && !currentId && !error && <EmptyPanel />}
      {snapshot && currentId && !error && (
        <>
          {(currentId === "user-agents" || currentId === "user-dsh") && (
            <FolderPanel
              folder={snapshot.user[currentId === "user-agents" ? 0 : 1]}
            />
          )}
          {currentId.startsWith("project:") &&
            (() => {
              const project = snapshot.projects.find(
                (item) => `project:${item.workspaceId}` === currentId,
              );
              if (!project) return null;
              const filled = project.folders.filter(
                (folder) => folder.skills.length > 0,
              );
              return (
                <div className="native-settings-skill-project-panel">
                  <div
                    className="native-settings-skill-folder-label"
                    title={project.path}
                  >
                    {project.path}
                  </div>
                  {filled.length > 0 ? (
                    filled.map((folder) => (
                      <div
                        key={folder.path}
                        className="native-settings-skill-folder"
                      >
                        <div
                          className="native-settings-skill-folder-label"
                          title={folder.path}
                        >
                          {folder.label}
                        </div>
                        <SkillGrid skills={folder.skills} />
                      </div>
                    ))
                  ) : (
                    <EmptyPanel />
                  )}
                </div>
              );
            })()}
        </>
      )}
    </>
  );
}

/** 单个技能文件夹面板：标题为显示路径，内容为卡片网格或空态。 */
function FolderPanel({ folder }: { folder: SkillFolderGroup }) {
  return (
    <div className="native-settings-skill-folder">
      <div className="native-settings-skill-folder-label" title={folder.path}>
        {folder.label}
      </div>
      {folder.skills.length > 0 ? (
        <SkillGrid skills={folder.skills} />
      ) : (
        <EmptyPanel />
      )}
    </div>
  );
}

function EmptyPanel() {
  const t = useT();
  return (
    <div className="native-settings-skills-empty">
      <div className="native-settings-skills-empty-title">
        {t("settings.skills.emptyFolder")}
      </div>
      <p>{t("settings.skills.emptyHint")}</p>
    </div>
  );
}

/** 技能卡片网格：名称与说明，双列自适应。 */
function SkillGrid({ skills }: { skills: SkillDisplayInfo[] }) {
  return (
    <div className="native-settings-skill-grid">
      {skills.map((skill) => (
        <div
          key={skill.name}
          className="native-settings-skill-card"
          title={skill.description}
        >
          <span className="native-settings-skill-card-name">{skill.name}</span>
          <span className="native-settings-skill-card-desc">
            {skill.description}
          </span>
        </div>
      ))}
    </div>
  );
}
