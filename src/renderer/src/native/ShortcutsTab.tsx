import { useT } from "../i18n";

interface ShortcutItem {
  id: string;
  labelKey: string;
  keys: string[];
}

interface ShortcutGroup {
  groupKey: string;
  items: ShortcutItem[];
}

/** 键盘快捷键分区：按业务分块速查（纯静态参考表，对齐真实注册键位）。 */
export function ShortcutsTab() {
  const t = useT();

  // 严格对齐青梧目前真实支持的快捷键
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
          keys: ["Esc", "Esc"],
        },
        {
          id: "mentionFile",
          labelKey: "settings.shortcuts.mentionFile",
          keys: ["@"],
        },
        {
          id: "slashCommand",
          labelKey: "settings.shortcuts.slashCommand",
          keys: ["/"],
        },
      ],
    },
    {
      groupKey: "settings.shortcuts.groupNavigation",
      items: [
        {
          id: "openSettings",
          labelKey: "settings.shortcuts.openSettings",
          keys: ["Ctrl", ","],
        },
        {
          id: "workspaceFiles",
          labelKey: "settings.shortcuts.workspaceFiles",
          keys: ["Ctrl", "P"],
        },
        {
          id: "openTerminal",
          labelKey: "settings.shortcuts.openTerminal",
          keys: ["Ctrl", "`"],
        },
      ],
    },
    {
      groupKey: "settings.shortcuts.groupApp",
      items: [
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
        {
          id: "toggleFullScreen",
          labelKey: "settings.shortcuts.toggleFullScreen",
          keys: ["F11"],
        },
        {
          id: "quit",
          labelKey: "settings.shortcuts.quit",
          keys: ["Alt", "F4"],
        },
      ],
    },
  ];

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>{t("settings.shortcuts.title")}</h2>
        <p>{t("settings.shortcuts.desc")}</p>
      </div>

      {groups.map((group) => (
        <div key={group.groupKey} className="native-settings-section">
          <div className="native-settings-section-title">
            {t(group.groupKey)}
          </div>
          <div className="native-settings-card">
            <div className="native-shortcuts-list">
              {group.items.map((item) => (
                <div key={item.id} className="native-shortcut-row">
                  <span className="native-shortcut-name">
                    {t(item.labelKey)}
                  </span>
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
              ))}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
