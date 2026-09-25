export type MenuName = "文件" | "编辑" | "视图" | "帮助";

/** 顶级菜单的固定排列顺序（左右方向键穿梭与悬停切换共用）。 */
export const MENU_NAMES: MenuName[] = ["文件", "编辑", "视图", "帮助"];

export interface MenuItemData {
  id: string;
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
    case "文件":
      return [
        { id: "reload", label: "重新加载", accelerator: "Ctrl+R" },
        {
          id: "reloadIgnoringCache",
          label: "强制重新加载",
          accelerator: "Ctrl+Shift+R",
        },
        { id: "sep-1", label: "", type: "separator" },
        {
          id: "openTerminal",
          label: "在终端中打开工作区",
          accelerator: "Ctrl+Shift+C",
        },
        { id: "openFolder", label: "在文件管理器中打开工作区" },
        { id: "sep-2", label: "", type: "separator" },
        { id: "quit", label: "退出", accelerator: "Alt+F4" },
      ];

    case "编辑":
      return [
        { id: "undo", label: "撤销", accelerator: "Ctrl+Z" },
        { id: "redo", label: "重做", accelerator: "Ctrl+Y" },
        { id: "sep-1", label: "", type: "separator" },
        { id: "cut", label: "剪切", accelerator: "Ctrl+X" },
        { id: "copy", label: "复制", accelerator: "Ctrl+C" },
        { id: "paste", label: "粘贴", accelerator: "Ctrl+V" },
        { id: "delete", label: "删除" },
        { id: "sep-2", label: "", type: "separator" },
        { id: "selectAll", label: "全选", accelerator: "Ctrl+A" },
        { id: "sep-3", label: "", type: "separator" },
        { id: "settings", label: "设置", accelerator: "Ctrl+," },
      ];

    case "视图":
      return [
        { id: "zoomIn", label: "放大", accelerator: "Ctrl++" },
        { id: "zoomOut", label: "缩小", accelerator: "Ctrl+-" },
        { id: "resetZoom", label: "重置缩放", accelerator: "Ctrl+0" },
        { id: "sep-1", label: "", type: "separator" },
        { id: "toggleFullScreen", label: "切换全屏", accelerator: "F11" },
        { id: "sep-2", label: "", type: "separator" },
        { id: "toggleDevTools", label: "开发者工具", accelerator: "F12" },
      ];

    case "帮助":
      return [
        { id: "checkForUpdates", label: "检查更新" },
        { id: "openGitHub", label: "GitHub 仓库" },
        { id: "about", label: "关于 青梧" },
      ];
  }
}
