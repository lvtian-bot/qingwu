import type { sidebar as zhSidebar } from "../zh-CN/sidebar";

export const sidebar: typeof zhSidebar = {
  brand: "Qingwu",
  search: {
    title: "Search sessions",
    placeholder: "Search sessions",
  },
  newChat: "New chat",
  sections: {
    pinned: "Pinned",
    projects: "Projects",
    sessions: "Sessions",
    addProject: "Add project",
    noProjects: "No projects yet",
  },
  group: {
    expand: "Show more",
    collapse: "Show less",
  },
  settings: "Settings",
  resizeTitle: "Drag to resize, double-click to reset",
  untitled: "Untitled",
  workspace: {
    renameAria: "Workspace name",
    pin: "Pin project",
    unpin: "Unpin project",
    menuTitle: "Workspace actions",
    menuAria: 'Actions for workspace "{name}"',
    newChatAria: 'New chat in "{name}"',
    moveUp: "Move project up",
    moveDown: "Move project down",
    openTerminal: "Open in Terminal",
    openFileManager: "Open in File Explorer",
    rename: "Rename workspace",
    delete: "Delete workspace",
    deleteConfirm:
      '"{name}" will be removed from the workspace list. Its folder and session history are kept, and its sessions will appear under "Ungrouped".',
    cancel: "Cancel",
    confirmDelete: "Delete",
  },
  session: {
    renameAria: "Session name",
    menuTitle: "Session actions",
    menuAria: 'Actions for session "{name}"',
    pin: "Pin session",
    unpin: "Unpin",
    rename: "Rename",
    archive: "Archive session",
  },
  status: {
    running: "Task in progress",
    unread: "Task completed, not viewed yet",
  },
  chip: {
    title: "Select a workspace",
    empty: "No workspaces yet",
    add: "Add workspace…",
  },
  archived: {
    title: "Archived sessions",
    subtitle: "Restore or manage archived sessions.",
    searchPlaceholder: "Search archived sessions (by title or project)...",
    clearSearchTitle: "Clear search",
    countAll: {
      one: "{count} archived session in total",
      other: "{count} archived sessions in total",
    },
    countFiltered: {
      one: "Matched {matched} of {count} session",
      other: "Matched {matched} of {count} sessions",
    },
    emptyTitle: "No archived sessions yet",
    emptyDesc:
      'Choose "Archive session" from a session\'s menu in the sidebar to tuck away sessions you rarely use and keep the main view tidy.',
    noMatchTitle: "No matching archived sessions",
    noMatchDesc: 'No sessions match "{query}". Try a different search term.',
    clearQuery: "Clear search",
    projectTagTitle: "Project: {name}",
    restoreOpenTitle: "Restore this session and open it now",
    restoreOpen: "Restore and open",
    unarchiveTitle:
      "Unarchive and move back to its original project or the session list",
    unarchive: "Unarchive",
    restoring: "Restoring…",
    unarchiveFailed: "Failed to unarchive: {message}",
    untitledProject: "Untitled project",
    untitledSession: "Untitled session",
    ungrouped: "Ungrouped",
  },
  errors: {
    forkUnavailable: "This session cannot be forked",
  },
};
