/**
 * 右侧面板的「工作区文件」页：从会话工作区根逐层浏览目录树，
 * 点击文件打开面板内预览。根目录与已展开目录经 workspaceFiles/changes
 * 监听自动刷新；折叠保留缓存，再次展开重新列举。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceDirectoryEntry } from "../protocol";
import { toErrMsg } from "../rpc";
import {
  basename,
  listDirectory,
  naturalNameCollator,
  splitPathDisplay,
  watchWorkspacePath,
} from "./workspace-files";
import { TreeChevron } from "./glyphs";

interface DirLevel {
  status: "loading" | "ready" | "failed";
  entries: WorkspaceDirectoryEntry[];
  truncated: boolean;
  error?: string;
}

const entryRank = (entry: WorkspaceDirectoryEntry) =>
  entry.type === "directory" ? 0 : entry.type === "file" ? 1 : 2;

function sortEntries(entries: WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort(
    (a, b) => entryRank(a) - entryRank(b) || naturalNameCollator.compare(a.name, b.name),
  );
}

function dirErrorMessage(message: string): string {
  if (message.includes("workspace-file/not-found")) return "目录不存在";
  if (message.includes("workspace-file/outside-workspace")) return "路径超出工作区范围";
  if (message.includes("workspace-file/not-directory")) return "路径不是目录";
  if (message.includes("bad-request")) return "路径不合法";
  return message;
}

interface PanelFilesProps {
  sessionId: string | null;
  /** 会话工作目录（树的根）。 */
  cwd?: string | null;
  /** 点击文件行：在面板内打开预览（工作区相对路径）。 */
  onOpenFile: (path: string) => void;
}

export function PanelFiles({ sessionId, cwd, onOpenFile }: PanelFilesProps) {
  const [levels, setLevels] = useState<Map<string, DirLevel>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /** 读取一个目录；force 时即便已就绪也重新列举（手动刷新、重新展开）。 */
  const ensureDir = useCallback(
    (dirAbs: string, force = false) => {
      if (!sessionId || !dirAbs) return;
      setLevels((prev) => {
        const cur = prev.get(dirAbs);
        if (cur && cur.status === "loading") return prev;
        if (cur && cur.status === "ready" && !force) return prev;
        const next = new Map(prev);
        // 读取期间保留已显示条目，不重置整棵树
        next.set(dirAbs, {
          status: "loading",
          entries: cur?.entries ?? [],
          truncated: cur?.truncated ?? false,
        });
        return next;
      });
      void (async () => {
        try {
          const listing = await listDirectory(sessionId, dirAbs);
          setLevels((prev) => {
            const cur = prev.get(dirAbs);
            if (!cur || cur.status !== "loading") return prev;
            const next = new Map(prev);
            next.set(dirAbs, {
              status: "ready",
              entries: sortEntries(listing.entries),
              truncated: listing.truncated,
            });
            return next;
          });
        } catch (err) {
          setLevels((prev) => {
            const cur = prev.get(dirAbs);
            if (!cur || cur.status !== "loading") return prev;
            const next = new Map(prev);
            next.set(dirAbs, {
              status: "failed",
              entries: [],
              truncated: false,
              error: dirErrorMessage(toErrMsg(err)),
            });
            return next;
          });
        }
      })();
    },
    [sessionId],
  );

  // 切会话（或工作目录变化）重置整棵树
  useEffect(() => {
    setLevels(new Map());
    setExpanded(new Set());
  }, [sessionId, cwd]);

  useEffect(() => {
    if (cwd) ensureDir(cwd);
  }, [cwd, ensureDir]);

  const toggleDir = useCallback((dirAbs: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirAbs)) next.delete(dirAbs);
      else next.add(dirAbs);
      return next;
    });
  }, []);

  if (!cwd) {
    return (
      <div className="panel-tree">
        <div className="panel-tree-note">当前会话没有关联的工作目录</div>
      </div>
    );
  }

  const refresh = () => {
    ensureDir(cwd, true);
    for (const dirAbs of expanded) ensureDir(dirAbs, true);
  };

  return (
    <div className="panel-tree">
      <div className="panel-files-header">
        <span className="panel-pathlabel" title={cwd}>
          <PathLabelParts path={cwd} />
        </span>
        <button
          type="button"
          className="native-icon-btn"
          onClick={refresh}
          title="重新读取"
          aria-label="重新读取目录"
        >
          <svg
            viewBox="0 0 16 16"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            <path d="M13.7 1.8v2.7h-2.7" />
          </svg>
        </button>
      </div>
      <div className="panel-tree-body" role="tree" aria-label="工作区文件树">
        <DirNode
          sessionId={sessionId}
          absPath={cwd}
          relPath=""
          name={basename(cwd)}
          depth={0}
          isRoot
          levels={levels}
          expanded={expanded}
          onToggle={toggleDir}
          ensureDir={ensureDir}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}

/** 目录行 + 展开态子项的递归节点。展开即重新列举，并持有该目录的失效监听。 */
function DirNode({
  sessionId,
  absPath,
  relPath,
  name,
  depth,
  isRoot = false,
  levels,
  expanded,
  onToggle,
  ensureDir,
  onOpenFile,
}: {
  sessionId: string | null;
  absPath: string;
  /** 相对工作区根的路径（根为空串）；文件预览按它打开。 */
  relPath: string;
  name: string;
  depth: number;
  isRoot?: boolean;
  levels: Map<string, DirLevel>;
  expanded: Set<string>;
  onToggle: (dirAbs: string) => void;
  ensureDir: (dirAbs: string, force?: boolean) => void;
  onOpenFile: (path: string) => void;
}) {
  const isOpen = isRoot || expanded.has(absPath);
  const level = levels.get(absPath);

  // 展开期间持有目录监听：子项变化自动重新列举（对齐官方自动刷新默认开启）
  useEffect(() => {
    if (!isOpen || !sessionId) return;
    ensureDir(absPath, true);
    return watchWorkspacePath(sessionId, absPath, {
      onChange: () => ensureDir(absPath, true),
    });
  }, [isOpen, sessionId, absPath, ensureDir]);

  const childDepth = isRoot ? 0 : depth + 1;
  const childRows = useMemo(() => {
    if (!isOpen || !level || level.status !== "ready") return null;
    if (level.entries.length === 0) {
      return <div className="panel-tree-note" style={{ paddingLeft: 6 + childDepth * 14 + 16 }}>此文件夹为空</div>;
    }
    return (
      <>
        {level.entries.map((entry) => {
          const childAbs = joinPath(absPath, entry.name);
          const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
          if (entry.type === "directory") {
            return (
              <DirNode
                key={`d:${childAbs}`}
                sessionId={sessionId}
                absPath={childAbs}
                relPath={childRel}
                name={entry.name}
                depth={childDepth}
                levels={levels}
                expanded={expanded}
                onToggle={onToggle}
                ensureDir={ensureDir}
                onOpenFile={onOpenFile}
              />
            );
          }
          if (entry.type === "file") {
            return (
              <button
                key={`f:${childAbs}`}
                type="button"
                className="panel-tree-row"
                style={{ paddingLeft: 6 + childDepth * 14 + 16 }}
                onClick={() => onOpenFile(childRel)}
                title={childAbs}
              >
                <span className="panel-tree-label">{entry.name}</span>
              </button>
            );
          }
          return (
            <div
              key={`o:${childAbs}`}
              className="panel-tree-row other"
              style={{ paddingLeft: 6 + childDepth * 14 + 16 }}
              title={childAbs}
            >
              <span className="panel-tree-label">{entry.name}</span>
            </div>
          );
        })}
        {level.truncated && (
          <div
            className="panel-tree-note"
            style={{ paddingLeft: 6 + childDepth * 14 + 16 }}
          >
            条目过多，其余已省略
          </div>
        )}
      </>
    );
  }, [isOpen, level, absPath, relPath, childDepth, sessionId, levels, expanded, onToggle, ensureDir, onOpenFile]);

  return (
    <>
      {!isRoot && (
        <button
          type="button"
          className="panel-tree-row"
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => onToggle(absPath)}
          aria-expanded={isOpen}
          title={absPath}
        >
          <TreeChevron open={isOpen} />
          <span className="panel-tree-label">{name}</span>
        </button>
      )}
      {isOpen && level?.status === "loading" && (level?.entries.length ?? 0) === 0 && (
        <div className="panel-tree-note" style={{ paddingLeft: 6 + childDepth * 14 + 16 }}>
          读取中…
        </div>
      )}
      {isOpen && level?.status === "failed" && (
        <div className="panel-tree-note" style={{ paddingLeft: 6 + childDepth * 14 + 16 }}>
          {level.error ?? "读取失败"}
        </div>
      )}
      {childRows}
    </>
  );
}

function joinPath(dirAbs: string, name: string): string {
  const sep = dirAbs.includes("\\") ? "\\" : "/";
  return `${dirAbs.replace(/[\\/]+$/, "")}${sep}${name}`;
}

/** 路径标签：目录段弱化、最后一段主色；空间不足时保留尾部并左侧渐隐。 */
export function PathLabelParts({ path }: { path: string }) {
  const { dir, base } = splitPathDisplay(path);
  return (
    <>
      {dir && <span className="panel-pathlabel-dir">{dir}</span>}
      <span className="panel-pathlabel-base">{base}</span>
    </>
  );
}
