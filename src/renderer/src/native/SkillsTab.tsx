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

/** 技能分区：主进程目录视图，按技能文件夹分别列出名称与说明。 */
export function SkillsTab({ workspaces, visible }: SkillsTabProps) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<SkillsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.skills.title")}</h2>
        <p>{t("settings.skills.desc")}</p>
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

      {!error && snapshot && (
        <>
          <div className="native-settings-skill-group">
            <div className="native-settings-skill-group-title">
              {t("settings.skills.userGroup")}
            </div>
            <p className="native-settings-skill-group-desc">
              {t("settings.skills.userGroupDesc")}
            </p>
            {snapshot.user.map((folder) => (
              <FolderSection key={folder.path} folder={folder} />
            ))}
          </div>

          {snapshot.projects.length > 0 && (
            <div className="native-settings-skill-group">
              <div className="native-settings-skill-group-title">
                {t("settings.skills.projectGroup")}
              </div>
              <p className="native-settings-skill-group-desc">
                {t("settings.skills.projectGroupDesc")}
              </p>
              {snapshot.projects.map((project) => (
                <div key={project.workspaceId} className="native-settings-skill-project">
                  <div
                    className="native-settings-skill-project-title"
                    title={project.path}
                  >
                    {project.title}
                  </div>
                  {project.folders.map((folder) => (
                    <FolderSection key={folder.path} folder={folder} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** 一个技能文件夹的小节：标题为显示路径，空文件夹显示占位说明。 */
function FolderSection({ folder }: { folder: SkillFolderGroup }) {
  const t = useT();
  return (
    <div className="native-settings-skill-folder">
      <div className="native-settings-skill-folder-label" title={folder.path}>
        {folder.label}
      </div>
      {folder.skills.length > 0 ? (
        <div className="native-settings-card">
          <SkillRows skills={folder.skills} />
        </div>
      ) : (
        <div className="native-settings-skill-folder-empty">
          {t("settings.skills.emptyFolder")}
        </div>
      )}
    </div>
  );
}

function SkillRows({ skills }: { skills: SkillDisplayInfo[] }) {
  return (
    <>
      {skills.map((skill, index) => (
        <div
          key={skill.name}
          className={`native-settings-skill-row${index > 0 ? " bordered" : ""}`}
        >
          <span className="native-settings-skill-name" title={skill.name}>
            {skill.name}
          </span>
          <span className="native-settings-skill-desc" title={skill.description}>
            {skill.description}
          </span>
        </div>
      ))}
    </>
  );
}
