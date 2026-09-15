import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { normalizeRotationDeg, useRotatable } from '../../src/hooks/useRotatable';
import { useDraggable } from '../../src/hooks/useDraggable';
import { cardGestureTransform } from '../../src/utils/nodeDragVisual';

function stubCardRect(el: HTMLElement, width: number, height: number) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  });
}

function rotatePointerDown(
  onPointerDown: (e: React.PointerEvent) => void,
  clientX: number,
  clientY: number,
) {
  onPointerDown({
    preventDefault() {},
    stopPropagation() {},
    clientX,
    clientY,
  } as React.PointerEvent);
}

describe('normalizeRotationDeg', () => {
  it('keeps values in (-180, 180]', () => {
    expect(normalizeRotationDeg(0)).toBe(0);
    expect(normalizeRotationDeg(90)).toBe(90);
    expect(normalizeRotationDeg(180)).toBe(180);
    expect(normalizeRotationDeg(-180)).toBe(180);
    expect(normalizeRotationDeg(270)).toBe(-90);
    expect(normalizeRotationDeg(-270)).toBe(90);
  });
});

describe('useRotatable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rotates from the live card center and reports on pointer up', () => {
    const el = document.createElement('div');
    stubCardRect(el, 200, 100);
    const elementRef = createRef<HTMLElement | null>();
    elementRef.current = el;
    const onRotateEnd = vi.fn();

    const { result } = renderHook(() => useRotatable(0, elementRef, onRotateEnd));

    // Center is (100, 50). Start at right of center (200, 50) → angle 0°.
    act(() => {
      rotatePointerDown(result.current.onPointerDown, 200, 50);
    });

    // Move to below center (100, 150) → angle 90°.
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 100, clientY: 150 }),
      );
    });

    expect(el.style.getPropertyValue('--node-rotate')).toBe('90deg');
    expect(el.style.transform).toContain('rotate(90deg)');
    expect(el.style.transform).not.toContain('var(--drag-x');
    expect(el.dataset.rotating).toBe('');
    expect(result.current.rotation).toBe(0);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });

    expect(el.dataset.rotating).toBeUndefined();
    expect(el.style.transform).toBe(cardGestureTransform());
    expect(result.current.rotation).toBe(90);
    expect(onRotateEnd).toHaveBeenCalledWith(90);
  });

  it('snaps to 15° increments while Shift is held', () => {
    const el = document.createElement('div');
    stubCardRect(el, 200, 200);
    const elementRef = createRef<HTMLElement | null>();
    elementRef.current = el;

    const { result } = renderHook(() => useRotatable(0, elementRef));

    act(() => {
      rotatePointerDown(result.current.onPointerDown, 200, 100);
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 180, clientY: 160, shiftKey: true }),
      );
    });

    const live = Number.parseFloat(el.style.getPropertyValue('--node-rotate'));
    expect(live % 15).toBe(0);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });

    expect(result.current.rotation % 15).toBe(0);
  });

  it('after rotate, drag still writes CSS vars into a var-based transform', () => {
    const el = document.createElement('div');
    el.style.transform = cardGestureTransform();
    stubCardRect(el, 200, 100);
    const elementRef = createRef<HTMLElement | null>();
    elementRef.current = el;

    const rotate = renderHook(() => useRotatable(0, elementRef));
    const drag = renderHook(() => useDraggable(40, 80, 1));

    act(() => {
      rotatePointerDown(rotate.result.current.onPointerDown, 200, 50);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 150 }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });

    expect(el.style.transform).toContain('var(--drag-x');
    expect(el.style.transform).not.toMatch(/translate\(\s*-?\d/);

    const pointerDown = {
      button: 0,
      clientX: 10,
      clientY: 10,
      target: el,
      currentTarget: el,
    } as unknown as React.PointerEvent<HTMLDivElement>;

    act(() => {
      drag.result.current.onPointerDown(pointerDown);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 25, clientY: 40 }));
    });

    expect(el.style.getPropertyValue('--drag-x')).toBe('15px');
    expect(el.style.getPropertyValue('--drag-y')).toBe('30px');
    expect(el.style.transform).toContain('var(--drag-x');
    expect(el.style.transform).not.toMatch(/translate\(\s*-?\d/);
    expect(el.style.left).toBe('');
  });
});
