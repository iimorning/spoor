import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock(import('react-i18next'), async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await (vi as any).importActual('react-i18next');
  return actual;
});

import { useTheme, initTheme } from '../../src/hooks/useTheme';

const STORAGE_KEY = 'app_theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTheme', () => {
  it('defaults to light mode when localStorage is empty', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('light');
  });

  it('restores persisted mode from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('dark');
  });

  it('persists mode to localStorage on change', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    act(() => result.current.setMode('light'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('applies data-theme to the document root', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    act(() => result.current.setMode('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('cycles light → dark → light', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('light');
    act(() => result.current.cycleTheme());
    expect(result.current.mode).toBe('dark');
    act(() => result.current.cycleTheme());
    expect(result.current.mode).toBe('light');
  });

  it('migrates legacy system to dark when prefers-color-scheme is dark', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    const matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('migrates legacy system to light when prefers-color-scheme is light', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    const matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    vi.unstubAllGlobals();
  });
});

describe('initTheme', () => {
  it('applies the stored mode synchronously at startup', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('falls back to light when nothing is stored', () => {
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('rewrites legacy system into an explicit light/dark value', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    const matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    initTheme();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.unstubAllGlobals();
  });
});
