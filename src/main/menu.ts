import { Menu } from "electron";
import { getMenuItems, MENU_NAMES } from "../shared/menu-data";

/** 隐藏的应用菜单只注册快捷键；定义与自绘菜单共用，动作统一分发。 */
export function createApplicationMenu(options: {
  onAction: (id: string) => void;
}) {
  // 菜单在界面上不可见，label 只作内部占位；用户可见文案由渲染层按词条 key 翻译。
  const template: Electron.MenuItemConstructorOptions[] = MENU_NAMES.map(
    (name) => ({
      label: name,
      submenu: getMenuItems(name).map((item) => ({
        label: item.label,
        type: item.type ?? "normal",
        checked: item.checked,
        enabled: !item.disabled,
        accelerator: item.accelerator?.replace("Ctrl++", "Ctrl+Plus"),
        click: () => options.onAction(item.id),
      })),
    }),
  );
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}
