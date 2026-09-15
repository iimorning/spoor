import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  NOTE_CJK_STORAGE_KEY,
  getCjkFontProgress,
  initNoteCjk,
  initNoteCjkAfterFirstPaint,
  loadNoteCjkFont,
  noteCjkFaceName,
  useNoteCjk,
} from '../../src/hooks/useNoteCjk';

function mockFetchBuffer(bytes: Uint8Array, contentLength?: string) {
  const headers = new Headers();
  if (contentLength) headers.set('Content-Length', contentLength);
  return vi.fn(async () =>
    new Response(bytes, {
      status: 200,
      headers,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-note-cjk');
  document.documentElement.removeAttribute('data-note-hand');
  vi.stubGlobal(
    'fetch',
    mockFetchBuffer(new Uint8Array([0, 1, 0, 0]), '4'),
  );
});

afterEach(() => {
  delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useNoteCjk', () => {
  it('defaults to system when storage is empty', () => {
    const { result } = renderHook(() => useNoteCjk());
    expect(result.current.id).toBe('system');
  });

  it('restores a stored face', () => {
    localStorage.setItem(NOTE_CJK_STORAGE_KEY, 'system');
    const { result } = renderHook(() => useNoteCjk());
    expect(result.current.id).toBe('system');
  });

  it('falls back to system for unknown legacy serif picks', () => {
    localStorage.setItem('app_serif', 'virgil');
    const { result } = renderHook(() => useNoteCjk());
    expect(result.current.id).toBe('system');
  });

  it('downloads a self-hosted face only after the user selects it in settings', async () => {
    const fetchMock = mockFetchBuffer(new Uint8Array([0, 1, 0, 0]), '4');
    vi.stubGlobal('fetch', fetchMock);
    class FakeFontFace {
      load = vi.fn(async () => this);
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn() },
    });

    const { result } = renderHook(() => useNoteCjk());
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => result.current.setNoteCjk('qingsong'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('persists a handwriting trial face', () => {
    const { result } = renderHook(() => useNoteCjk());
    act(() => result.current.setNoteCjk('yozai'));
    expect(localStorage.getItem(NOTE_CJK_STORAGE_KEY)).toBe('yozai');
    expect(document.documentElement.dataset.noteCjk).toBe('yozai');
    expect(document.documentElement.dataset.noteHand).toBe('1');
  });

  it('does not mark zhuque as a handwriting face', () => {
    const { result } = renderHook(() => useNoteCjk());
    act(() => result.current.setNoteCjk('zhuque'));
    expect(document.documentElement.dataset.noteHand).toBeUndefined();
  });
});

describe('initNoteCjk', () => {
  it('applies the stored face before React mounts', () => {
    localStorage.setItem(NOTE_CJK_STORAGE_KEY, 'system');
    initNoteCjk();
    expect(document.documentElement.dataset.noteCjk).toBe('system');
  });

  it('does not download stored faces on startup', async () => {
    localStorage.setItem(NOTE_CJK_STORAGE_KEY, 'qingsong');
    const fetchMock = mockFetchBuffer(new Uint8Array([0, 1, 0, 0]), '4');
    vi.stubGlobal('fetch', fetchMock);

    initNoteCjkAfterFirstPaint();

    expect(document.documentElement.dataset.noteCjk).toBe('qingsong');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('loadNoteCjkFont', () => {
  it('skips OS default', async () => {
    const Face = vi.fn();
    vi.stubGlobal('FontFace', Face);
    await loadNoteCjkFont('system');
    expect(Face).not.toHaveBeenCalled();
  });

  it('fetches woff2 and reports progress for a self-hosted face', async () => {
    const load = vi.fn(async function (this: { family: string }) {
      return this;
    });
    class FakeFontFace {
      family: string;
      source: ArrayBuffer | string;
      load = load;
      constructor(family: string, source: ArrayBuffer | string) {
        this.family = family;
        this.source = source;
      }
    }
    const add = vi.fn();
    vi.stubGlobal('FontFace', FakeFontFace);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add } });
    const fetchMock = mockFetchBuffer(new Uint8Array([1, 2, 3, 4]), '4');
    vi.stubGlobal('fetch', fetchMock);

    await loadNoteCjkFont('marker');

    expect(fetchMock).toHaveBeenCalledWith('/fonts/LXGWMarkerGothic-Regular.woff2');
    expect(noteCjkFaceName('marker')).toBe('LXGW Marker Gothic');
    expect(load).toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
    expect(getCjkFontProgress().percent).toBe(100);
    await vi.waitFor(() => expect(getCjkFontProgress().active).toBe(false));
  });
});
