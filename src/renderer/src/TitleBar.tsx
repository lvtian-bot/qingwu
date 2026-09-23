import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { MENU_NAMES, type MenuName } from "../../shared/menu-data";
import "./titlebar.css";

const MENU_ITEMS = MENU_NAMES;

function QingwuIcon() {
  return (
    <svg
      className="titlebar-icon-svg"
      width="16"
      height="16"
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="512" cy="512" r="512" fill="#14B8A6" />
      <circle cx="512" cy="512" r="484" stroke="#5EEAD4" strokeWidth="24" />
      <path
        d="M494 776C496 716 496 648 500 584C500 552 500 526 500 500C500 492 524 492 524 500C524 526 524 552 524 584C528 648 528 716 530 776C530 790 522 798 512 800C502 798 494 790 494 776Z"
        fill="white"
      />
      <path
        d="M506 524C454 518 400 490 364 446C330 404 334 342 340 278C400 298 458 332 492 390C518 434 520 486 506 524Z"
        fill="white"
      />
      <path
        d="M518 524C570 518 624 490 660 446C694 404 690 342 684 278C624 298 566 332 532 390C506 434 504 486 518 524Z"
        fill="white"
      />
    </svg>
  );
}

/**
 * 标题栏菜单触发器：只负责高亮与向主进程子窗口弹层发指令。
 * 菜单本体由独立透明子窗口渲染（MenuPopupView），双界面（青梧 / DeepSeek）共用同一套自绘样式，
 * 官方界面下天然浮于 WebContentsView 之上，不推挤页面、无黑带。
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
