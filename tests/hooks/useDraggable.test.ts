import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TOUCH_CARD_DRAG_THRESHOLD_PX, useDraggable } from '../../src/hooks/useDraggable';

function mouseDown(el: HTMLElement, clientX: number, clientY: number, extra?: Partial<React.PointerEvent<HTMLDivElement>>) {
  return {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX,
    clientY,
    target: el,
    currentTarget: el,
    ...extra,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

function touchDown(el: HTMLElement, clientX: number, clientY: number, extra?: Partial<React.PointerEvent<HTMLDivElement>>) {
  return {
    button: 0,
    pointerType: 'touch',
    pointerId: 7,
    clientX,
    clientY,
    target: el,
    currentTarget: el,
    ...extra,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

describe('useDraggable', () => {
  it('reports move delta and end position for group-drag consumers', async () => {
    const onEnd = vi.fn();
    const onMove = vi.fn();
    const { result } = renderHook(() => useDraggable(100, 200, 1, onEnd, onMove));

    const shell = document.createElement('div');
    const pointerDown = mouseDown(shell, 50, 50);

    act(() => {
      result.current.onPointerDown(pointerDown);
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 80, clientY: 90, pointerId: 1 }),
      );
    });

    expect(onMove).toHaveBeenCalled();
    const lastMove = onMove.mock.calls.at(-1)!;
    expect(lastMove[0]).toEqual({ x: 130, y: 240 });
    expect(lastMove[1]).toEqual({ dx: 30, dy: 40 });
    // Hot path: CSS vars only — left/top stay for React until pointerup.
    expect(shell.style.getPropertyValue('--drag-x')).toBe('30px');
    expect(shell.style.getPropertyValue('--drag-y')).toBe('40px');
    expect(shell.dataset.dragging).toBe('');
    expect(shell.style.left).toBe('');
    expect(shell.style.top).toBe('');

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    });

    expect(shell.style.left).toBe('130px');
    expect(shell.style.top).toBe('240px');
    expect(shell.style.getPropertyValue('--drag-x')).toBe('0px');
    expect(shell.style.getPropertyValue('--drag-y')).toBe('0px');
    expect(shell.dataset.dragging).toBeUndefined();

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(onEnd).toHaveBeenCalledWith({ x: 130, y: 240 }, { dx: 30, dy: 40 });
        resolve();
      }, 5);
    });
  });

  it('mouse pointer on contenteditable / data-no-drag does not start a drag', () => {
    const { result } = renderHook(() => useDraggable(40, 80, 1));
    const shell = document.createElement('div');
    const body = document.createElement('div');
    body.setAttribute('data-no-drag', '');
    shell.appendChild(body);

    act(() => {
      result.current.onPointerDown(mouseDown(shell, 10, 10, { target: body }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 50, pointerId: 1 }));
    });
    expect(shell.style.getPropertyValue('--drag-x')).toBe('');
    expect(shell.style.left).toBe('');
  });

  it('touch pointer on data-no-drag still drags after crossing the slop', () => {
    const { result } = renderHook(() => useDraggable(40, 80, 1));
    const shell = document.createElement('div');
    const body = document.createElement('div');
    body.setAttribute('data-no-drag', '');
    shell.appendChild(body);

    act(() => {
      result.current.onPointerDown(touchDown(shell, 10, 10, { target: body }));
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 10 + TOUCH_CARD_DRAG_THRESHOLD_PX - 1,
          clientY: 10,
          pointerId: 7,
          pointerType: 'touch',
        }),
      );
    });
    expect(shell.style.getPropertyValue('--drag-x')).toBe('');

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 10 + TOUCH_CARD_DRAG_THRESHOLD_PX + 4,
          clientY: 18,
          pointerId: 7,
          pointerType: 'touch',
        }),
      );
    });
    expect(shell.style.getPropertyValue('--drag-x')).toBe(`${TOUCH_CARD_DRAG_THRESHOLD_PX + 4}px`);
    expect(shell.style.getPropertyValue('--drag-y')).toBe('8px');
    expect(shell.style.left).toBe('');
  });

  it('mouse click without movement does not suppress the following click (note edit)', () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useDraggable(40, 80, 1, onEnd));
    const shell = document.createElement('div');
    const child = document.createElement('div');
    const onClick = vi.fn();
    child.addEventListener('click', onClick);
    shell.appendChild(child);

    act(() => {
      result.current.onPointerDown(mouseDown(shell, 10, 10, { target: child }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse' }));
    });
    child.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(shell.style.left).toBe('');
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('mouse drag past the slop suppresses the following click', () => {
    const { result } = renderHook(() => useDraggable(40, 80, 1));
    const shell = document.createElement('div');
    const child = document.createElement('div');
    const onClick = vi.fn();
    child.addEventListener('click', onClick);
    shell.appendChild(child);

    act(() => {
      result.current.onPointerDown(mouseDown(shell, 10, 10, { target: child }));
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 30, clientY: 10, pointerId: 1, pointerType: 'mouse' }),
      );
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse' }));
    });
    child.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('touch tap below the slop does not commit left/top (so click-to-edit still works)', () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useDraggable(40, 80, 1, onEnd));
    const shell = document.createElement('div');

    act(() => {
      result.current.onPointerDown(touchDown(shell, 10, 10));
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 12, clientY: 11, pointerId: 7, pointerType: 'touch' }),
      );
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch' }));
    });

    expect(shell.style.left).toBe('');
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('pointercancel reverts the live offset and does not commit', () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useDraggable(40, 80, 1, onEnd));
    const shell = document.createElement('div');

    act(() => {
      result.current.onPointerDown(touchDown(shell, 10, 10));
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 40, clientY: 50, pointerId: 7, pointerType: 'touch' }),
      );
    });
    expect(shell.style.getPropertyValue('--drag-x')).toBe('30px');

    act(() => {
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, pointerType: 'touch' }));
    });

    expect(shell.style.getPropertyValue('--drag-x')).toBe('0px');
    expect(shell.dataset.dragging).toBeUndefined();
    expect(shell.style.left).toBe('');
    expect(onEnd).not.toHaveBeenCalled();
  });
});
