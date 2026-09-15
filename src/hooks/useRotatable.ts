import { useState, useRef, useEffect } from 'react';
import { beginNodeRotate, endNodeRotate, applyLiveNodeRotate, setNodeRotateDeg } from '../utils/nodeDragVisual';

function pointerAngleDeg(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}

/** Normalize degrees into (-180, 180]. */
export function normalizeRotationDeg(deg: number): number {
  const n = ((((deg + 180) % 360) + 360) % 360) - 180;
  return n === -180 ? 180 : n;
}

export function useRotatable(
  initialRotation: number,
  elementRef: React.RefObject<HTMLElement | null>,
  onRotateEnd?: (rotation: number) => void,
) {
  const [rotation, setRotation] = useState(initialRotation);
  const rotationRef = useRef(rotation);
  const rotatingRef = useRef(false);
  const onRotateEndRef = useRef(onRotateEnd);
  onRotateEndRef.current = onRotateEnd;

  useEffect(() => {
    rotationRef.current = rotation;
  }, [rotation]);

  useEffect(() => {
    if (rotatingRef.current) return;
    setRotation(initialRotation);
    const el = elementRef.current;
    if (el) setNodeRotateDeg(el, initialRotation);
  }, [initialRotation, elementRef]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const el = elementRef.current;
    if (!el) return;

    rotatingRef.current = true;
    beginNodeRotate(el);
    // Screen-space center is stable while rotating around the card's own origin;
    // re-reading getBoundingClientRect every move would force layout.
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startPointerAngle = pointerAngleDeg(cx, cy, e.clientX, e.clientY);
    const startRotation = rotationRef.current;
    applyLiveNodeRotate(el, startRotation);

    const handle = e.currentTarget as HTMLElement | null;
    const pointerId = e.pointerId;
    handle?.setPointerCapture?.(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const currentAngle = pointerAngleDeg(cx, cy, moveEvent.clientX, moveEvent.clientY);
      let next = startRotation + (currentAngle - startPointerAngle);
      if (moveEvent.shiftKey) {
        next = Math.round(next / 15) * 15;
      }
      next = normalizeRotationDeg(next);
      rotationRef.current = next;
      applyLiveNodeRotate(el, next);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      handle?.releasePointerCapture?.(pointerId);
      rotatingRef.current = false;
      const next = rotationRef.current;
      setNodeRotateDeg(el, next);
      endNodeRotate(el);
      setRotation(next);
      onRotateEndRef.current?.(next);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return { rotation, onPointerDown };
}
