import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MenuItemData } from "../../shared/menu-data";
import "./titlebar.css";

interface MenuDropdownProps {
  items: MenuItemData[];
  label: string;
  onAction: (id: string) => void;
  onClose: () => void;
  onSwitchMenu?: (direction: "left" | "right") => void;
  style?: CSSProperties;
}

export function MenuDropdown({
  items,
  label,
  onAction,
  onClose,
  onSwitchMenu,
  style,
}: MenuDropdownProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const actionableIndices = items
    .map((item, idx) =>
      item.type !== "separator" && !item.disabled ? idx : -1,
    )
    .filter((idx) => idx !== -1);

  // 菜单项集合变化（穿梭切换 / 状态刷新）时重置键盘选中态，不依赖外层重挂载。
  useEffect(() => {
    setSelectedIndex(-1);
    containerRef.current?.focus();
  }, [items]);

  useEffect(() => {
    if (selectedIndex >= 0)
      containerRef.current
        ?.querySelector(`#menu-item-${selectedIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // 键盘快捷键导航支持（ArrowUp / ArrowDown / ArrowLeft / ArrowRight / Enter / Space / Escape）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => {
          if (!actionableIndices.length) return -1;
          const currentPos = actionableIndices.indexOf(prev);
          const nextPos = (currentPos + 1) % actionableIndices.length;
          return actionableIndices[nextPos];
        });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => {
          if (!actionableIndices.length) return -1;
          const currentPos = actionableIndices.indexOf(prev);
          const nextPos =
            currentPos <= 0 ? actionableIndices.length - 1 : currentPos - 1;
          return actionableIndices[nextPos];
        });
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        onSwitchMenu?.("left");
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        onSwitchMenu?.("right");
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          const item = items[selectedIndex];
          if (item && item.type !== "separator" && !item.disabled) {
            onAction(item.id);
          }
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    actionableIndices,
    items,
    onAction,
    onClose,
    onSwitchMenu,
    selectedIndex,
  ]);

  return (
    <div
      ref={containerRef}
      className="titlebar-dropdown-menu"
      style={style}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      aria-activedescendant={
        selectedIndex >= 0 ? `menu-item-${selectedIndex}` : undefined
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => {
        if (item.type === "separator") {
          return (
            <div
              key={`sep-${index}`}
              className="titlebar-dropdown-separator"
              role="separator"
            />
          );
        }

        const isSelected = selectedIndex === index;
        const isCheckbox = item.type === "checkbox";

        return (
          <div
            key={item.id}
            id={`menu-item-${index}`}
            className={
              "titlebar-dropdown-item" +
              (isSelected ? " selected" : "") +
              (item.disabled ? " disabled" : "")
            }
            role={isCheckbox ? "menuitemcheckbox" : "menuitem"}
            aria-checked={isCheckbox ? Boolean(item.checked) : undefined}
            aria-disabled={item.disabled}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => {
              if (!item.disabled) {
                onAction(item.id);
              }
            }}
          >
            {/* Win32 上下文菜单标准规范：左侧统一固定宽度的 Gutter 留白与对勾指示，确保所有项文本垂直基准线绝对对齐 */}
            <span className="titlebar-dropdown-gutter" aria-hidden="true">
              {isCheckbox && item.checked ? (
                <svg
                  className="titlebar-dropdown-check-icon"
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3.2 8.3L6.3 11.4L12.8 4.6" />
                </svg>
              ) : null}
            </span>

            <span className="titlebar-dropdown-item-label">{item.label}</span>

            {item.accelerator && (
              <span className="titlebar-dropdown-item-shortcut">
                {item.accelerator}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
