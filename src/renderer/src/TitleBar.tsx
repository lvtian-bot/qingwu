import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import "./titlebar.css";

const MENU_ITEMS = ["文件", "编辑", "视图", "帮助"] as const;
type MenuName = (typeof MENU_ITEMS)[number];

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

export function TitleBar() {
  const [activeMenu, setActiveMenu] = useState<MenuName | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const disarmPointerGuardRef = useRef<() => void>(() => {});

  const clearActiveMenu = () => {
    disarmPointerGuardRef.current();
    setActiveMenu(null);
  };

  // 原生菜单开启期间持有鼠标捕获，页面收不到任何指针事件；Esc、再点菜单按钮、
  // 点击标题栏其他位置等关闭路径既不触发 popup 回调也不改变焦点，因此页面
  // 收到的第一个指针事件即意味着菜单已关闭，以此清除按钮高亮。
  const armPointerGuard = () => {
    disarmPointerGuardRef.current();
    const onPointer = () => {
      disarm();
      setActiveMenu(null);
    };
    const disarm = () => {
      window.removeEventListener("mousemove", onPointer, true);
      window.removeEventListener("mousedown", onPointer, true);
      disarmPointerGuardRef.current = () => {};
    };
    window.addEventListener("mousemove", onPointer, true);
    window.addEventListener("mousedown", onPointer, true);
    disarmPointerGuardRef.current = disarm;
  };

  useEffect(() => {
    const unsubMenu = window.qingwu?.onMenuClosed?.(() => {
      clearActiveMenu();
    });

    const unsubFs = window.qingwu?.onFullscreenChanged?.((fs) => {
      setIsFullScreen(Boolean(fs));
    });

    return () => {
      disarmPointerGuardRef.current();
      unsubMenu?.();
      unsubFs?.();
    };
  }, []);

  const handleMenuClick = (
    menuName: MenuName,
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveMenu(menuName);
    armPointerGuard();
    window.qingwu?.popupMenu?.({
      menuName,
      x: rect.left,
      y: rect.bottom,
    });
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
        <nav className="titlebar-menu" aria-label="应用菜单">
          {MENU_ITEMS.map((item) => (
            <button
              key={item}
              type="button"
              className={
                "titlebar-menu-item" + (activeMenu === item ? " active" : "")
              }
              onClick={(e) => handleMenuClick(item, e)}
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
