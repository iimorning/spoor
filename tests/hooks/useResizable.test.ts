import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useResizable } from '../../src/hooks/useResizable';

describe('useResizable', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts resize from measured DOM size when stored height is 0 (content-sized)', () => {
    const scaleRef = { current: 1 };
    const elementRef = createRef<HTMLElement | null>();
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: 320 });
    Object.defineProperty(el, 'offsetHeight', { value: 240 });
    elementRef.current = el;

    const { result } = renderHook(() =>
      useResizable(320, 0, scaleRef, undefined, elementRef),
    );

    expect(result.current.size).toEqual({ width: 320, height: 0 });

    act(() => {
      result.current.onPointerDown({
        preventDefault() {},
        stopPropagation() {},
        clientX: 100,
        clientY: 100,
      } as React.PointerEvent);
    });

    expect(result.current.size).toEqual({ width: 320, height: 240 });

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 120, clientY: 130 }),
      );
    });

    expect(result.current.size).toEqual({ width: 340, height: 270 });

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
  });

  it('accounts for canvas scale when dragging', () => {
    const scaleRef = { current: 2 };
    const elementRef = createRef<HTMLElement | null>();
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: 200 });
    Object.defineProperty(el, 'offsetHeight', { value: 100 });
    elementRef.current = el;

    const { result } = renderHook(() =>
      useResizable(200, 100, scaleRef, undefined, elementRef),
    );

    act(() => {
      result.current.onPointerDown({
        preventDefault() {},
        stopPropagation() {},
        clientX: 0,
        clientY: 0,
      } as React.PointerEvent);
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 40, clientY: 20 }),
      );
    });

    expect(result.current.size).toEqual({ width: 220, height: 110 });

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
  });
});
