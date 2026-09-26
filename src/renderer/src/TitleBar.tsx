import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { MENU_NAMES, type MenuName } from "../../shared/menu-data";
import "./titlebar.css";

const MENU_ITEMS = MENU_NAMES;

const QINGWU_ICON_URL = "data:image/png;base64,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";

function QingwuIcon() {
  return (
    <img
      className="titlebar-icon-svg"
      src={QINGWU_ICON_URL}
      width="16"
      height="16"
      alt="青梧"
      aria-hidden="true"
    />
  );
}

/**
 * 标题栏菜单触发器：只负责高亮与向主进程子窗口弹层发指令。
 * 菜单本体由独立透明子窗口渲染（MenuPopupView），采用自绘样式与 Windows 原生系统菜单体验对齐。
 */
export function TitleBar({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [activeMenu, setActiveMenu] = useState<MenuName | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const menuButtonsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  /** activeMenu 的同步镜像：menu-closed 回调订阅于挂载时，需读取最新值。 */
  const activeMenuRef = useRef<MenuName | null>(null);
  /**
   * 弹窗聚焦期间主窗口收不到指针事件；弹窗因点击外部失焦关闭后，紧随的那次 click 不应把菜单再打开。
   * 仅当关闭原因是 blur 且本次点击命中的正是刚关闭的那个菜单（同一次手势的 toggle 关闭）时抑制；
   * 点击其他菜单标题（切换）、Esc / 执行动作后的再点（显式关闭）都应立即响应。
   */
  const lastClosedRef = useRef<{
    menu: MenuName | null;
    at: number;
    byBlur: boolean;
  } | null>(null);

  const openMenu = (
    menuName: MenuName,
    btnEl: HTMLButtonElement,
    viaSwitch = false,
  ) => {
    const rect = btnEl.getBoundingClientRect();
    activeMenuRef.current = menuName;
    setActiveMenu(menuName);
    void window.qingwu?.openMenuPopup?.({
      menuName,
      x: rect.left,
      y: rect.bottom,
      viaSwitch,
    });
  };

  const closeMenu = () => {
    activeMenuRef.current = null;
    setActiveMenu(null);
    void window.qingwu?.closeMenuPopup?.();
  };

  useEffect(() => {
    const unsubSwitch = window.qingwu?.onMenuSwitch?.((name) => {
      const button = menuButtonsRef.current[name];
      if (button && activeMenuRef.current) openMenu(name, button, true);
    });
    const unsubFs = window.qingwu?.onFullscreenChanged?.((fs) => {
      setIsFullScreen(Boolean(fs));
    });

    // 菜单关闭信号统一来自主进程弹层（动作 / Esc / 失焦 / 再点按钮），以此清除高亮。
    const unsubMenu = window.qingwu?.onMenuClosed?.((reason) => {
      lastClosedRef.current = {
        menu: activeMenuRef.current,
        at: Date.now(),
        byBlur: reason === "blur",
      };
      activeMenuRef.current = null;
      setActiveMenu(null);
    });

    return () => {
      unsubSwitch?.();
      unsubFs?.();
      unsubMenu?.();
    };
  }, []);

  const handleMenuClick = (
    menuName: MenuName,
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    if (activeMenu === menuName) {
      closeMenu();
      return;
    }
    // 该 click 之前的 mousedown 已让弹窗失焦关闭（收到 menu-closed）：本次点击语义为“关闭”，不再重开。
    const last = lastClosedRef.current;
    if (
      !activeMenu &&
      last?.byBlur &&
      last.menu === menuName &&
      Date.now() - last.at < 350
    ) {
      return;
    }
    openMenu(menuName, e.currentTarget);
  };

  // 悬停穿梭切换（对齐现代桌面应用）：已展开时移到其他顶级项，直接原位切换弹层内容。
  // viaSwitch：不递增打开会话号，弹层瞬时换内容、不重放入场动画。
  const handleMenuMouseEnter = (
    menuName: MenuName,
    btnEl: HTMLButtonElement,
  ) => {
    if (activeMenu && activeMenu !== menuName) {
      openMenu(menuName, btnEl, true);
    }
  };

  if (isFullScreen) {
    return null;
  }

  return (
    <header className="titlebar" data-testid="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-icon">
          <QingwuIcon />
        </div>
        <button
          type="button"
          className="titlebar-side-toggle"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "打开侧边栏" : "收起侧边栏"}
          aria-label={sidebarCollapsed ? "打开侧边栏" : "收起侧边栏"}
          aria-pressed={!sidebarCollapsed}
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
        <nav className="titlebar-menu" aria-label="应用菜单">
          {MENU_ITEMS.map((item) => (
            <button
              key={item}
              ref={(el) => {
                menuButtonsRef.current[item] = el;
              }}
              type="button"
              className={
                "titlebar-menu-item" + (activeMenu === item ? " active" : "")
              }
              onMouseDown={(e) => e.preventDefault()}
              aria-haspopup="menu"
              aria-expanded={activeMenu === item}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  openMenu(item, e.currentTarget);
                }
              }}
              onClick={(e) => handleMenuClick(item, e)}
              onMouseEnter={() => {
                const el = menuButtonsRef.current[item];
                if (el) handleMenuMouseEnter(item, el);
              }}
            >
              {item}
            </button>
          ))}
        </nav>
      </div>

      <div className="titlebar-controls-spacer" aria-hidden="true" />
    </header>
  );
}
