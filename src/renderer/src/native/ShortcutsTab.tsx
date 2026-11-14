import { useT } from "../i18n";
import { SettingsSwitch } from "./settings-ui";
import { useState } from "react";

interface ShortcutItem {
  id: string;
  labelKey: string;
  keys: string[];
}

interface ShortcutGroup {
  groupKey: string;
  items: ShortcutItem[];
}

/** 键盘快捷键分区：按业务分块速查与开关（参照成熟桌面标杆规范）。 */
export function ShortcutsTab() {
  const t = useT();

  // 快捷键定义分组
  const groups: ShortcutGroup[] = [
    {
      groupKey: "settings.shortcuts.groupInput",
      items: [
        {
          id: "sendMessage",
          labelKey: "settings.shortcuts.sendMessage",
          keys: ["Enter"],
        },
        {
          id: "newline",
          labelKey: "settings.shortcuts.newline",
          keys: ["Shift", "Enter"],
        },
        {
          id: "stopGeneration",
          labelKey: "settings.shortcuts.stopGeneration",
          keys: ["Esc"],
        },
      ],
    },
    {
      groupKey: "settings.shortcuts.groupChat",
      items: [
        {
          id: "newChat",
          labelKey: "settings.shortcuts.newChat",
          keys: ["Ctrl", "N"],
        },
        {
          id: "focusInput",
          labelKey: "settings.shortcuts.focusInput",
          keys: ["Ctrl", "L"],
        },
        {
          id: "archiveChat",
          labelKey: "settings.shortcuts.archiveChat",
          keys: ["Ctrl", "Shift", "A"],
        },
      ],
    },
    {
      groupKey: "settings.shortcuts.groupApp",
      items: [
        {
          id: "openSettings",
          labelKey: "settings.shortcuts.openSettings",
          keys: ["Ctrl", ","],
        },
        {
          id: "toggleSidebar",
          labelKey: "settings.shortcuts.toggleSidebar",
          keys: ["Ctrl", "B"],
        },
        {
          id: "closeWindow",
          labelKey: "settings.shortcuts.closeWindow",
          keys: ["Ctrl", "W"],
        },
        {
          id: "zoomIn",
          labelKey: "settings.shortcuts.zoomIn",
          keys: ["Ctrl", "+"],
        },
        {
          id: "zoomOut",
          labelKey: "settings.shortcuts.zoomOut",
          keys: ["Ctrl", "-"],
        },
        {
          id: "zoomReset",
          labelKey: "settings.shortcuts.zoomReset",
          keys: ["Ctrl", "0"],
        },
      ],
    },
  ];

  // 快捷键启用状态（本地响应态）
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});

  const toggleShortcut = (id: string) => {
    setEnabledMap((prev) => ({
      ...prev,
      [id]: prev[id] === undefined ? false : !prev[id],
    }));
  };

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.shortcuts.title")}</h2>
        <p>{t("settings.shortcuts.desc")}</p>
      </div>

      {groups.map((group) => (
        <div key={group.groupKey} className="native-settings-card">
          <div className="native-settings-section-title">
            {t(group.groupKey)}
          </div>
          <div className="native-shortcuts-list">
            {group.items.map((item) => {
              const isEnabled = enabledMap[item.id] ?? true;
              return (
                <div key={item.id} className="native-shortcut-row">
                  <div className="native-shortcut-left">
                    <SettingsSwitch
                      checked={isEnabled}
                      onChange={() => toggleShortcut(item.id)}
                      label={t(item.labelKey)}
                    />
                    <span className="native-shortcut-name">
                      {t(item.labelKey)}
                    </span>
                  </div>
                  <div className="native-shortcut-keys">
                    {item.keys.map((k, index) => (
                      <span key={index} className="native-shortcut-key-wrap">
                        <kbd className="native-shortcut-kbd">{k}</kbd>
                        {index < item.keys.length - 1 && (
                          <span className="native-shortcut-plus">+</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
