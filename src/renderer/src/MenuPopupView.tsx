import { useEffect, useRef, useState } from "react";
import {
  getMenuItems,
  type MenuName,
  type MenuStateContext,
} from "../../shared/menu-data";
import { MenuDropdown } from "./MenuDropdown";
import "./titlebar.css";

interface MenuPopupPayload {
  menuName: MenuName;
  sessionId: number;
  context: MenuStateContext;
}

/**
 * 菜单弹层页面（独立透明子窗口，?view=menu 路由）。
 * 与标题栏共用同一套 MenuDropdown / Win32 规范样式，双界面渲染完全一致。
 */
export function MenuPopupView() {
  const [data, setData] = useState<MenuPopupPayload | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const unsub = window.qingwu?.onMenuPopupData?.((payload) => {
      // null = 弹层已关闭：立即清空内容，隐藏窗口不留旧帧，下次打开从透明入场。
      setData(payload ?? null);
    });

    // 加载完成握手：首开竞态期间主进程发过的数据可能丢失，由主进程补发。
    void window.qingwu?.menuPopupReady?.();

    return () => {
      unsub?.();
    };
  }, []);

  // 实测菜单 DOM 宽高回报主进程收紧窗口：样式即事实，主进程不做公式推算。
  // 观测与上报都针对菜单面板本身（外层容器 width:100% 恒等于窗口宽，量它会把宽度锁死在初值）。
  // 多重时机上报（rAF×2 + 80ms + 200ms），确保字体回退、穿梭切换重挂载等晚到布局也被捕捉。
  useEffect(() => {
    const el = containerRef.current;
    if (!data || !el) return;
    const target = el.querySelector<HTMLElement>(".titlebar-dropdown-menu") ?? el;
    let raf1 = 0;
    let raf2 = 0;
    const timers: number[] = [];
    const report = () => {
      // offsetWidth / offsetHeight 为布局尺寸，不受入场动画 scale 变换污染
      const w = Math.max(target.offsetWidth, target.scrollWidth);
      const h = Math.max(target.offsetHeight, target.scrollHeight);
      if (w > 0 && h > 0) {
        // 带菜单名上报：主进程按菜单缓存尺寸，下次打开前精确预置窗口，不裁剪跳动。
        void window.qingwu?.resizeMenuPopup?.({
          width: w,
          height: h,
          menuName: data.menuName,
        });
      }
    };
    const observer = new ResizeObserver(report);
    observer.observe(target);
    raf1 = requestAnimationFrame(report);
    raf2 = requestAnimationFrame(() => {
      report();
      timers.push(window.setTimeout(report, 80));
      timers.push(window.setTimeout(report, 200));
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [data]);

  if (!data) return null;

  const items = getMenuItems(data.menuName, data.context);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "auto",
        background: "transparent",
        overflow: "hidden",
        boxSizing: "border-box",
        padding: 0,
        margin: 0,
      }}
    >
      {/*
        key = 打开会话号：仅用户发起新打开时变化，整棵重挂载 → 弹出动画每次打开都重放；
        悬停 / 方向键穿梭不换 key，只更新 items → 瞬时换内容，面板本体与阴影纹丝不动。
      */}
      <div key={data.sessionId} className="menu-popup-enter">
        <MenuDropdown
          items={items}
          onAction={(actionId) => {
            void window.qingwu?.executeMenuAction?.(actionId);
          }}
          onClose={() => {
            void window.qingwu?.closeMenuPopup?.();
          }}
          onSwitchMenu={(direction) => {
            void window.qingwu?.switchMenuPopup?.(direction);
          }}
          style={{
            position: "static",
            margin: 0,
          }}
        />
      </div>
    </div>
  );
}
