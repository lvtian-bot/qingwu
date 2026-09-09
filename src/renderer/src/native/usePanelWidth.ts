/**
 * 可拖拽调节的面板宽度：指针拖拽 + localStorage 记忆 + 双击复位。
 */
import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface PanelWidthOptions {
  /** localStorage 持久化键。 */
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
}

export function usePanelWidth({ storageKey, defaultWidth, min, max }: PanelWidthOptions) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(storageKey));
      return Number.isFinite(stored) && stored > 0 ? clamp(stored, min, max) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const persist = useCallback(
    (value: number) => {
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // 存储不可用时静默降级为会话内记忆
      }
    },
    [storageKey]
  );

  /** 指针按下开始拖拽：宽度 = 起始宽度 + 水平位移 × direction（左栏 +1 / 右栏 -1）。 */
  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, direction: 1 | -1) => {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      const startX = e.clientX;
      const startWidth = widthRef.current;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      document.body.classList.add('native-resizing');

      const onMove = (ev: PointerEvent) => {
        const next = clamp(startWidth + (ev.clientX - startX) * direction, min, max);
        widthRef.current = next;
        setWidth(next);
      };
      const finish = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', finish);
        el.removeEventListener('pointercancel', finish);
        el.classList.remove('dragging');
        document.body.classList.remove('native-resizing');
        persist(widthRef.current);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', finish);
      el.addEventListener('pointercancel', finish);
    },
    [min, max, persist]
  );

  /** 双击复位默认宽度。 */
  const reset = useCallback(() => {
    widthRef.current = defaultWidth;
    setWidth(defaultWidth);
    persist(defaultWidth);
  }, [defaultWidth, persist]);

  return { width, startDrag, reset };
}
