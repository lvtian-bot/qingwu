export type MenuName = "file" | "edit" | "view" | "help";

/** 顶级菜单的固定排列顺序（左右方向键穿梭与悬停切换共用）。 */
export const MENU_NAMES: MenuName[] = ["file", "edit", "view", "help"];

/** 菜单名在标题栏的显示文案 key（词条见渲染层 i18n menu 域）。 */
export const MENU_NAME_KEYS: Record<MenuName, string> = {
  file: "menu.file.name",
  edit: "menu.edit.name",
  view: "menu.view.name",
  help: "menu.help.name",
};

export interface MenuItemData {
  id: string;
  /** 显示文案的词条 key（menu.<group>.<item>），由渲染层 t() 翻译。 */
  label: string;
  accelerator?: string;
  type?: "normal" | "separator" | "checkbox";
  checked?: boolean;
  disabled?: boolean;
}

export interface MenuStateContext {}

export function getMenuItems(
  menuName: MenuName,
  _context?: MenuStateContext,
): MenuItemData[] {
  switch (menuName) {
    case "file":
      return [
        { id: "reload", label: "menu.file.reload", accelerator: "Ctrl+R" },
        {
          id: "reloadIgnoringCache",
          label: "menu.file.reloadIgnoringCache",
          accelerator: "Ctrl+Shift+R",
        },
        { id: "sep-1", label: "", type: "separator" },
        {
          id: "openTerminal",
          label: "menu.file.openTerminal",
          accelerator: "Ctrl+Shift+C",
        },
        { id: "openFolder", label: "menu.file.openFolder" },
        { id: "sep-2", label: "", type: "separator" },
        { id: "quit", label: "menu.file.quit", accelerator: "Alt+F4" },
      ];

    case "edit":
      return [
        { id: "undo", label: "menu.edit.undo", accelerator: "Ctrl+Z" },
        { id: "redo", label: "menu.edit.redo", accelerator: "Ctrl+Y" },
        { id: "sep-1", label: "", type: "separator" },
        { id: "cut", label: "menu.edit.cut", accelerator: "Ctrl+X" },
        { id: "copy", label: "menu.edit.copy", accelerator: "Ctrl+C" },
        { id: "paste", label: "menu.edit.paste", accelerator: "Ctrl+V" },
        { id: "delete", label: "menu.edit.delete" },
        { id: "sep-2", label: "", type: "separator" },
        { id: "selectAll", label: "menu.edit.selectAll", accelerator: "Ctrl+A" },
        { id: "sep-3", label: "", type: "separator" },
        { id: "settings", label: "menu.edit.settings", accelerator: "Ctrl+," },
      ];

    case "view":
      return [
        { id: "zoomIn", label: "menu.view.zoomIn", accelerator: "Ctrl++" },
        { id: "zoomOut", label: "menu.view.zoomOut", accelerator: "Ctrl+-" },
        { id: "resetZoom", label: "menu.view.resetZoom", accelerator: "Ctrl+0" },
        { id: "sep-1", label: "", type: "separator" },
        {
          id: "toggleFullScreen",
          label: "menu.view.toggleFullScreen",
          accelerator: "F11",
        },
        { id: "sep-2", label: "", type: "separator" },
        {
          id: "toggleDevTools",
          label: "menu.view.toggleDevTools",
          accelerator: "F12",
        },
      ];

    case "help":
      return [
        { id: "checkForUpdates", label: "menu.help.checkForUpdates" },
        { id: "openGitHub", label: "menu.help.openGitHub" },
        { id: "about", label: "menu.help.about" },
      ];
  }
}
