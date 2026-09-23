import { Menu } from "electron";
import { getMenuItems, MENU_NAMES } from "../shared/menu-data";
import { settings } from "./settings";

/** 隐藏的应用菜单只注册快捷键；定义与自绘菜单共用，动作统一分发。 */
export function createApplicationMenu(options: {
  onAction: (id: string) => void;
}) {
  const template: Electron.MenuItemConstructorOptions[] = MENU_NAMES.map(
    (label) => ({
      label,
      submenu: getMenuItems(label, {
        uiMode: settings.get("uiMode"),
      }).map((item) => ({
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
