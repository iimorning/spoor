import React, { useState, useRef, useEffect } from 'react';
import { clearNodeDragOffset, setNodeDragOffset } from '../utils/nodeDragVisual';

let maxZIndex = 10;

export type DragDelta = { dx: number; dy: number };

/** Screen-space slop so a tap/click can still enter edit; past this it's a drag. */
export const TOUCH_CARD_DRAG_THRESHOLD_PX = 8;

function isTouchLikePointer(e: { pointerType?: string }): boolean {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

function isHardDragBlocker(target: HTMLElement): boolean {
  const tag = target.tagName;
  return (
    tag === 'BUTTON' ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'VIDEO' ||
    Boolean(target.closest('button')) ||
    Boolean(target.closest('a')) ||
    Boolean(target.closest('input, textarea, select'))
  );
}

function isMouseTextRegion(target: HTMLElement): boolean {
  return (
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]')) ||
    Boolean(target.closest('[data-no-drag]'))
  );
}

function suppressNextClick(el: HTMLElement) {
  const prevent = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  el.addEventListener('click', prevent, { capture: true, once: true });
}

export type DragEndResult = { revert?: boolean } | void;

export function useDraggable(
  initialX: number,
  initialY: number,
  scale: number = 1,
  onDragEnd?: (pos: { x: number; y: number }, delta: DragDelta) => DragEndResult | Promise<DragEndResult>,
  onDragMove?: (pos: { x: number; y: number }, delta: DragDelta) => void,
) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  // Claim a fresh top z so newly spawned cards aren't trapped under an already-dragged node.
  const [zIndex, setZIndex] = useState(() => {
    maxZIndex += 1;
    return maxZIndex;
  });
  const scaleRef = useRef(scale);
  const posRef = useRef(pos);
  const draggingRef = useRef(false);
  const onDragEndRef = useRef(onDragEnd);
  const onDragMoveRef = useRef(onDragMove);
  scaleRef.current = scale;
  onDragEndRef.current = onDragEnd;
  onDragMoveRef.current = onDragMove;

  // Keep posRef up to date so we can send the latest pos on up
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // Follow Dexie-driven moves (e.g. web-search source collapse/expand) without
  // fighting an in-progress drag.
  useEffect(() => {
    if (draggingRef.current) return;
    setPos((prev) => (prev.x === initialX && prev.y === initialY ? prev : { x: initialX, y: initialY }));
  }, [initialX, initialY]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const touchLike = isTouchLikePointer(e);
    // Middle button is reserved for canvas panning. Touch/pen report button 0.
    if (!touchLike && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (isHardDragBlocker(target)) return;
    // Mouse: leave text selection / inner scroll alone. Touch: the body IS the
    // drag handle (no hover chrome), so contenteditable and data-no-drag still drag.
    if (!touchLike && isMouseTextRegion(target)) return;

    draggingRef.current = true;

    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = { ...posRef.current };
    // Mouse used to arm immediately + capture + suppress click, which ate
    // NoteBody's click-to-edit. Wait for slop on both mouse and touch; only
    // capture once it is a real drag so the click still lands on the body.
    let armed = false;

    const capturePointer = () => {
      if (!el.isConnected) return;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* jsdom / already-released */
      }
    };

    const detach = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      if (!el.isConnected) return;
      try {
        if (typeof el.hasPointerCapture !== 'function' || el.hasPointerCapture(pointerId)) {
          el.releasePointerCapture(pointerId);
        }
      } catch {
        /* ignore */
      }
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (pointerId != null && moveEvent.pointerId !== pointerId) return;
      const screenDx = moveEvent.clientX - startX;
      const screenDy = moveEvent.clientY - startY;
      if (!armed) {
        if (screenDx * screenDx + screenDy * screenDy < TOUCH_CARD_DRAG_THRESHOLD_PX ** 2) {
          return;
        }
        armed = true;
        maxZIndex += 1;
        setZIndex(maxZIndex);
        capturePointer();
      }
      const dx = screenDx / scaleRef.current;
      const dy = screenDy / scaleRef.current;
      const next = { x: initialPos.x + dx, y: initialPos.y + dy };
      posRef.current = next;
      // Translate via CSS vars — avoids left/top layout thrash; React keeps base left/top.
      setNodeDragOffset(el, dx, dy);
      onDragMoveRef.current?.(next, { dx, dy });
    };

    const onPointerUp = () => {
      detach();
      draggingRef.current = false;
      if (!armed) {
        clearNodeDragOffset(el);
        return;
      }
      const finalPos = posRef.current;
      const delta = {
        dx: finalPos.x - initialPos.x,
        dy: finalPos.y - initialPos.y,
      };
      clearNodeDragOffset(el, finalPos);
      setPos(finalPos);
      suppressNextClick(el);
      if (onDragEndRef.current) {
        const origin = initialPos;
        setTimeout(() => {
          void Promise.resolve(onDragEndRef.current?.(finalPos, delta)).then((result) => {
            if (!result?.revert) return;
            clearNodeDragOffset(el, origin);
            posRef.current = origin;
            setPos(origin);
          });
        }, 0);
      }
    };

    const onPointerCancel = () => {
      detach();
      draggingRef.current = false;
      // Browser stole the gesture (scroll/zoom) — revert the live offset, don't commit.
      clearNodeDragOffset(el);
      posRef.current = initialPos;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  return { pos, onPointerDown, zIndex };
}
