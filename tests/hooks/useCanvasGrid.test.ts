import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useCanvasGrid, initCanvasGrid } from '../../src/hooks/useCanvasGrid';

const STORAGE_KEY = 'canvas_grid';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-canvas-grid');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCanvasGrid', () => {
  it('defaults to enabled when localStorage is empty', () => {
    const { result } = renderHook(() => useCanvasGrid());
    expect(result.current.enabled).toBe(true);
  });

  it('restores the persisted off state from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'off');
    const { result } = renderHook(() => useCanvasGrid());
    expect(result.current.enabled).toBe(false);
  });

  it('treats an unrecognized stored value as on', () => {
    localStorage.setItem(STORAGE_KEY, 'nonsense');
    const { result } = renderHook(() => useCanvasGrid());
    expect(result.current.enabled).toBe(true);
  });

  it('persists the mode to localStorage on change', () => {
    const { result } = renderHook(() => useCanvasGrid());
    act(() => result.current.setEnabled(false));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('off');
    act(() => result.current.setEnabled(true));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('on');
  });

  it('applies data-canvas-grid to the document root', () => {
    const { result } = renderHook(() => useCanvasGrid());
    expect(document.documentElement.dataset.canvasGrid).toBe('on');
    act(() => result.current.setEnabled(false));
    expect(document.documentElement.dataset.canvasGrid).toBe('off');
  });

  it('toggles on → off → on', () => {
    const { result } = renderHook(() => useCanvasGrid());
    expect(result.current.enabled).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
  });
});

describe('initCanvasGrid', () => {
  it('applies the stored mode synchronously at startup', () => {
    localStorage.setItem(STORAGE_KEY, 'off');
    initCanvasGrid();
    expect(document.documentElement.dataset.canvasGrid).toBe('off');
  });

  it('falls back to on when nothing is stored', () => {
    initCanvasGrid();
    expect(document.documentElement.dataset.canvasGrid).toBe('on');
  });
});
