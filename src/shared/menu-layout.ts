/**
 * 菜单窗口给投影留出的 DIP；渲染层同步用于透明内边距。
 * 顶部不留透明内边距（0 DIP），确保子窗口在物理上完全位于标题栏按钮下方，
 * 绝不侵入遮挡标题栏菜单项，从而保证鼠标在菜单栏上向左、向右移动时均能正常触发穿梭切换。
 * 左、右、下三面保留 16 DIP，完整容纳外发光与下沉投影。
 */
export const MENU_SHADOW_INSET_X = 16;
export const MENU_SHADOW_INSET_TOP = 0;
export const MENU_SHADOW_INSET_BOTTOM = 16;
/** 兼容旧引用（水平方向留白） */
export const MENU_SHADOW_INSET = MENU_SHADOW_INSET_X;

export interface MenuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 页面坐标乘页面缩放倍率后才是窗口 DIP；系统 DPI 由 Electron 处理。 */
export function getMenuBounds(
  content: MenuRect,
  anchor: { x: number; y: number },
  zoom: number,
  size: { width: number; height: number },
  workArea: MenuRect,
): MenuRect {
  const width = Math.min(Math.ceil(size.width), workArea.width);
  const height = Math.min(Math.ceil(size.height), workArea.height);
  const x = Math.round(content.x + anchor.x * zoom - MENU_SHADOW_INSET_X);
  const y = Math.round(content.y + anchor.y * zoom - MENU_SHADOW_INSET_TOP);
  return {
    x: Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}
