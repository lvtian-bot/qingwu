import type { menu as zhMenu } from "../zh-CN/menu";

export const menu: typeof zhMenu = {
  appMenu: "App menu",
  file: {
    name: "File",
    reload: "Reload",
    reloadIgnoringCache: "Force Reload",
    openTerminal: "Open Workspace in Terminal",
    openFolder: "Open Workspace in File Manager",
    quit: "Exit",
  },
  edit: {
    name: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    delete: "Delete",
    selectAll: "Select All",
    settings: "Settings",
  },
  view: {
    name: "View",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    resetZoom: "Reset Zoom",
    toggleFullScreen: "Toggle Full Screen",
    toggleDevTools: "Toggle Developer Tools",
  },
  help: {
    name: "Help",
    checkForUpdates: "Check for Updates",
    openGitHub: "GitHub Repository",
    about: "About Qingwu",
  },
  sidebar: {
    show: "Show Sidebar",
    hide: "Hide Sidebar",
  },
};
