import { useState, useRef, useEffect } from 'react';

export function useResizable(
  initialWidth: number,
  initialHeight: number,
  scaleRef: React.MutableRefObject<number>,
  onResizeEnd?: (size: { width: number; height: number }) => void,
  elementRef?: React.RefObject<HTMLElement | null>,
) {
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const sizeRef = useRef(size);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  // Keep local size in sync when persisted dimensions load or change.
  useEffect(() => {
    setSize((prev) => ({
      width: initialWidth > 0 ? initialWidth : prev.width,
      height: initialHeight > 0 ? initialHeight : prev.height,
    }));
  }, [initialWidth, initialHeight]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;

    // Cards often omit stored height and size via content; measure the live box
    // so resize starts from what the user sees instead of collapsing to mins.
    const el = elementRef?.current;
    const measuredW = el?.offsetWidth ?? 0;
    const measuredH = el?.offsetHeight ?? 0;
    const initialSize = {
      width: measuredW > 0 ? measuredW : Math.max(100, sizeRef.current.width || initialWidth),
      height: measuredH > 0 ? measuredH : Math.max(50, sizeRef.current.height || initialHeight),
    };
    sizeRef.current = initialSize;
    setSize(initialSize);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const scale = scaleRef.current || 1;
      const next = {
        width: Math.max(100, initialSize.width + (moveEvent.clientX - startX) / scale),
        height: Math.max(50, initialSize.height + (moveEvent.clientY - startY) / scale),
      };
      sizeRef.current = next;
      setSize(next);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (onResizeEnd) {
        onResizeEnd(sizeRef.current);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return { size, onPointerDown };
}
