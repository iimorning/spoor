/**
 * Lightweight pointer-drag hook for the canvas-template preview canvas.
 *
 * Unlike `useDraggable`, this:
 *  - Returns fractions of a 1200×800 design canvas.
 *  - Does not bump any module-scoped z-index counter (the preview lives outside
 *    the live canvas shell).
 *  - Mid-drag visual is driven by React state; the preview area is small
 *    (≤10 nodes), so re-renders are acceptable.
 *
 * Usage:
 *   const { pos, bind } = usePreviewDraggable({ initialXFrac, initialYFrac });
 *   return (
 *     <div ref={containerRef}>
 *       <div {...bind} style={{ left: pos.xFrac * 1200, top: pos.yFrac * 800 }} />
 *     </div>
 *   );
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface PreviewDragOptions {
  /** Fraction on the design canvas width (0..1). */
  initialXFrac: number;
  /** Fraction on the design canvas height (0..1). */
  initialYFrac: number;
  /** Fires on drag end with the new (clamped) fractions. */
  onChange?: (next: { xFrac: number; yFrac: number }) => void;
}

export interface PreviewDragReturn {
  /** Position the consumer should render at. */
  pos: { xFrac: number; yFrac: number };
  /** Bind onto the draggable element (NOT a wrapper). */
  bind: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    style: { cursor: 'grab' | 'grabbing'; touchAction: 'none' };
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Returns the bounding rect of the *preview container* (the element passed via
 * `containerRef`). The draggable elements inside position themselves as
 * percentages of this container's pixel size, so resizing the preview resizes
 * the drag area too.
 */
export function usePreviewContainerRect(
  containerRef: React.RefObject<HTMLElement | null>,
): { left: number; top: number; width: number; height: number } | null {
  const [rect, setRect] = useState<ReturnType<typeof usePreviewContainerRect>>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setRect({
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.clientWidth,
        height: el.clientHeight,
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return rect;
}

export function usePreviewDraggable(options: PreviewDragOptions): PreviewDragReturn {
  const { initialXFrac, initialYFrac, onChange } = options;

  const [pos, setPos] = useState(() => ({
    xFrac: clamp01(initialXFrac),
    yFrac: clamp01(initialYFrac),
  }));
  const [dragging, setDragging] = useState(false);

  const posRef = useRef(pos);
  const onChangeRef = useRef(onChange);
  const containerRectRef = useRef<{ width: number; height: number } | null>(null);
  posRef.current = pos;
  onChangeRef.current = onChange;

  // External updates follow unless we're mid-drag.
  useEffect(() => {
    const next = { xFrac: clamp01(initialXFrac), yFrac: clamp01(initialYFrac) };
    if (dragging) return;
    setPos((prev) =>
      prev.xFrac === next.xFrac && prev.yFrac === next.yFrac ? prev : next,
    );
  }, [initialXFrac, initialYFrac, dragging]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'button, a, input, textarea, [data-no-drag], [contenteditable="true"]',
        )
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      // Use the bounding rect of the draggable element's GRANDPARENT
      // (the preview container) so coords map to the design canvas percentage.
      // We walk up looking for a sibling — the consumer should mark the preview
      // container with `data-preview-container`.
      let previewContainer: HTMLElement | null = e.currentTarget;
      while (previewContainer && previewContainer.dataset.previewContainer !== 'true') {
        previewContainer = previewContainer.parentElement;
      }
      if (!previewContainer) return;
      const rect = previewContainer.getBoundingClientRect();
      containerRectRef.current = { width: rect.width, height: rect.height };

      const startScreenX = e.clientX;
      const startScreenY = e.clientY;
      const startFrac = { ...posRef.current };

      setDragging(true);

      const onMove = (ev: PointerEvent) => {
        const c = containerRectRef.current;
        if (!c || c.width === 0 || c.height === 0) return;
        const dxFrac = (ev.clientX - startScreenX) / c.width;
        const dyFrac = (ev.clientY - startScreenY) / c.height;
        setPos({
          xFrac: clamp01(startFrac.xFrac + dxFrac),
          yFrac: clamp01(startFrac.yFrac + dyFrac),
        });
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        const finalPos = posRef.current;
        onChangeRef.current?.(finalPos);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [],
  );

  return {
    pos,
    bind: {
      onPointerDown,
      style: { cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' },
    },
  };
}
