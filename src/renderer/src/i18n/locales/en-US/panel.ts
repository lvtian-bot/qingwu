import type { panel as zhPanel } from "../zh-CN/panel";

export const panel: typeof zhPanel = {
  shell: {
    ariaLabel: "Workspace panel",
    resizerTitle: "Drag to resize, double-click to reset",
    collapse: "Collapse panel",
  },
  fullscreen: {
    enter: "Full screen",
    exit: "Exit full screen",
  },
  tab: {
    newTab: "New tab",
    guide: "New tab",
    files: "Workspace files",
    closeTitle: "Close",
    closeNamed: "Close {name}",
    closeTarget: "tab",
  },
  guide: {
    files: {
      title: "Workspace files",
      desc: "Browse files in the session workspace",
    },
    terminal: {
      title: "New terminal",
      desc: "Run commands in the session workspace",
    },
  },
  files: {
    noSessionNote: "Select a session to browse its workspace files",
    noCwdNote: "This session has no working directory",
    refreshTitle: "Refresh",
    refreshAria: "Refresh directory",
    treeAria: "Workspace file tree",
    emptyFolder: "This folder is empty",
    truncated: "Too many entries; the rest are omitted",
    loading: "Loading…",
    readFailed: "Failed to read",
    error: {
      notFound: "Directory not found",
      outsideWorkspace: "Path is outside the workspace",
      notDirectory: "Path is not a directory",
      badRequest: "Invalid path",
    },
  },
  preview: {
    noSession: "No session selected",
    imageFailed: "Failed to load image",
    fileVanished: "The file no longer exists or has been deleted",
    wrapOffTitle: "Turn off word wrap",
    wrapOnTitle: "Turn on word wrap",
    reloadTitle: "Reload",
    openExternal: "Open with the system default app",
    loadingDoc: "Loading document…",
    retry: "Retry",
    unsupported: "This file type can't be previewed in the panel",
    loadMore: "Load more",
    loadingMore: "Loading…",
    codeOverflow: "Content is too long; showing the first {count} lines",
    emptyFile: "(Empty file)",
    error: {
      notFound: "File not found",
      notText: "Not a text file",
      tooLarge: "File exceeds the maximum readable size",
      notRegularFile: "Not a regular file",
      outsideWorkspace: "Path is outside the workspace",
    },
  },
};
