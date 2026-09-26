/**
 * 面板用的小型图形：文件类型徽标、引导页入口插画与罗盘、形态切换控件。
 * 全部自绘 SVG（官方 dsh-client-ui-primitives 未声明运行时依赖，无法安全复用），
 * 配色对齐官方 FileTypeIcon / 引导插画的大类色板，明暗主题共用。
 */
import type { ReactNode } from "react";
import type { FileTypeInfo } from "./workspace-files";

/** 通用页面图形：底板 + 白色折角，标记随类别变化（对齐官方传统图形结构）。 */
function FilePlate({
  color,
  children,
  size = 16,
}: {
  color: string;
  children?: ReactNode;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 1.5h6.2L13 5.3V13a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2 13V3a1.5 1.5 0 0 1 1-1.5z"
        fill={color}
      />
      <path d="M9.2 1.5 13 5.3H9.2z" fill="rgba(255,255,255,0.42)" />
      {children}
    </svg>
  );
}

function lines(y1: number, y2: number, color = "rgba(255,255,255,0.9)") {
  return (
    <g stroke={color} strokeWidth="1.2" strokeLinecap="round">
      <path d={`M5 ${y1}h4.4`} />
      <path d={`M5 ${y2}h4.4`} />
    </g>
  );
}

/** 文件类型徽标：按大类用色，形状沿用「彩色底板 + 白色标记」的官方视觉语言。 */
export function FileGlyph({
  info,
  size = 16,
}: {
  info: FileTypeInfo;
  size?: number;
}) {
  switch (info.badge) {
    case "doc":
      return (
        <FilePlate color="#185ABD" size={size}>
          {lines(7.4, 10)}
        </FilePlate>
      );
    case "sheet":
      return (
        <FilePlate color="#107C41" size={size}>
          <g stroke="rgba(255,255,255,0.9)" strokeWidth="1.1">
            <path d="M4.6 7.6h6.8v4H4.6z" />
            <path d="M8 7.6v4M4.6 9.6h6.8" />
          </g>
        </FilePlate>
      );
    case "slide":
      return (
        <FilePlate color="#C43E1C" size={size}>
          <g stroke="rgba(255,255,255,0.9)" strokeWidth="1.1" strokeLinecap="round">
            <path d="M4.6 6.8h6.8v3.4H4.6z" />
            <path d="M8 10.2v1.8M6.4 12h3.2" />
          </g>
        </FilePlate>
      );
    case "pdf":
      return (
        <FilePlate color="#B30B00" size={size}>
          {lines(7.6, 10)}
        </FilePlate>
      );
    case "image":
      return (
        <FilePlate color="#7A4FC9" size={size}>
          <circle cx="6" cy="7.4" r="1" fill="rgba(255,255,255,0.92)" />
          <path
            d="M4.4 11.4 7 8.6l1.6 1.6 1.4-1.4 1.6 2.6z"
            fill="rgba(255,255,255,0.9)"
          />
        </FilePlate>
      );
    case "code":
      return (
        <FilePlate color="#0E7490" size={size}>
          <g
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <path d="M6.4 7.2 5 8.6l1.4 1.4" />
            <path d="M9.6 7.2 11 8.6l-1.4 1.4" />
          </g>
        </FilePlate>
      );
    case "zip":
      return (
        <FilePlate color="#B45309" size={size}>
          <g stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" strokeLinecap="round">
            <path d="M8 4.6v5" />
            <path d="M6.8 11.2h2.4" />
          </g>
        </FilePlate>
      );
    case "text":
      return (
        <FilePlate color="#5A6472" size={size}>
          {lines(7.4, 10)}
        </FilePlate>
      );
    default:
      return <FilePlate color="#6B7280" size={size} />;
  }
}

/** 引导页入口插画（36px）：黄色工作区文件夹。 */
export function GuideFolderArtwork() {
  return (
    <svg viewBox="0 0 36 36" width="34" height="34" fill="none" aria-hidden="true">
      <path
        d="M4 9.5A3.5 3.5 0 0 1 7.5 6h6.2c1 0 2 .44 2.66 1.2l1.4 1.6c.47.55 1.16.87 1.89.87h8.85A3.5 3.5 0 0 1 32 13.17v1.33H4z"
        fill="#F0B429"
      />
      <path
        d="M4 12.6c0-1.44 1.3-2.53 2.72-2.28l23.5 4.02c1.06.18 1.83 1.1 1.83 2.18v11.2a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 27.72z"
        fill="#F6C445"
      />
      <path
        d="M4 12.6c0-1.44 1.3-2.53 2.72-2.28l4.1.7-2.9 19.1H6.4A2.4 2.4 0 0 1 4 27.72z"
        fill="rgba(255,255,255,0.28)"
      />
    </svg>
  );
}

/** 引导页入口插画（36px）：终端提示符。 */
export function GuideTerminalArtwork() {
  return (
    <svg viewBox="0 0 36 36" width="34" height="34" fill="none" aria-hidden="true">
      <rect x="4" y="6" width="28" height="24" rx="4" fill="#3B4A63" />
      <rect x="4" y="6" width="28" height="24" rx="4" fill="url(#tg)" />
      <defs>
        <linearGradient id="tg" x1="4" y1="6" x2="32" y2="30">
          <stop stopColor="#4C5F80" />
          <stop offset="1" stopColor="#33415A" />
        </linearGradient>
      </defs>
      <g stroke="#8FD0F0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 14l4 4-4 4" />
        <path d="M17 22h8" />
      </g>
    </svg>
  );
}

/** 引导页罗盘（tab 页签与开始页居中图形）。 */
export function CompassIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 13.4 13.4 8.5 15.5l2.1-4.9z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 面板收起图标：右缘竖线（会话标题栏的「打开面板」按钮用）。 */
export function PanelRightIcon() {
  return (
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
      <path d="M15 4v16" />
    </svg>
  );
}

/** 面板收起动作图标：右栏折叠到右缘。 */
export function PanelCollapseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M15 4v16" />
      <path d="m9.5 10-2 2 2 2" />
    </svg>
  );
}

/** 全屏切换图标：进入/退出覆盖整窗形态。 */
export function PanelFullscreenIcon({ active }: { active?: boolean }) {
  return active ? (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3H5a2 2 0 0 0-2 2v4M3 15v4a2 2 0 0 0 2 2h4M15 21h4a2 2 0 0 0 2-2v-4M21 9V5a2 2 0 0 0-2-2h-4" />
      <path d="M9.5 9.5 7 7M14.5 9.5 17 7M9.5 14.5 7 17M14.5 14.5 17 17" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}

/** 文件树行折叠箭头。 */
export function TreeChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      className="panel-tree-chevron"
      data-open={open || undefined}
      aria-hidden="true"
    >
      <path d="M6.2 3.2a.75.75 0 0 0 0 1.1L9.4 8l-3.2 3.7a.75.75 0 1 0 1.1 1.1l3.75-4.25a.75.75 0 0 0 0-1.1L7.3 3.2a.75.75 0 0 0-1.1 0z" />
    </svg>
  );
}
