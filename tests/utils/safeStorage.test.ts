import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  readLocalStorage,
  writeLocalStorage,
  removeLocalStorage,
} from '../../src/utils/safeStorage';

/**
 * Safari ("Block All Cookies", old private mode, non-persistent webviews) throws
 * a SecurityError as soon as localStorage is *touched* — the property exists, the
 * accessor throws. These helpers run on the pre-mount startup path, so a leak here
 * takes the whole app down to the boot spinner.
 *
 * Only this app's own keys throw: a blanket `Storage.prototype` spy also breaks
 * supabase-js's async session reads and produces unrelated unhandled rejections.
 */
const APP_STORAGE_KEYS = new Set(['app_theme', 'app_language', 'canvas_grid']);
const realLocalStorage = window.localStorage;

function blockAppStorageKeys(): void {
  const insecure = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  const blocked = (key: string) => APP_STORAGE_KEYS.has(key);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (blocked(key) ? insecure() : realLocalStorage.getItem(key)),
      setItem: (key: string, value: string) =>
        blocked(key) ? insecure() : realLocalStorage.setItem(key, value),
      removeItem: (key: string) =>
        blocked(key) ? insecure() : realLocalStorage.removeItem(key),
      clear: () => realLocalStorage.clear(),
      key: (index: number) => realLocalStorage.key(index),
      get length() {
        return realLocalStorage.length;
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: realLocalStorage });
  realLocalStorage.clear();
});

describe('safeStorage', () => {
  it('reads, writes and removes when storage works', () => {
    writeLocalStorage('app_theme', 'dark');
    expect(readLocalStorage('app_theme')).toBe('dark');
    removeLocalStorage('app_theme');
    expect(readLocalStorage('app_theme')).toBeNull();
  });

  it('returns null instead of throwing when reads are blocked', () => {
    blockAppStorageKeys();
    expect(readLocalStorage('app_theme')).toBeNull();
  });

  it('does not throw when writes are blocked', () => {
    blockAppStorageKeys();
    expect(() => writeLocalStorage('app_theme', 'dark')).not.toThrow();
  });

  it('does not throw when removal is blocked', () => {
    blockAppStorageKeys();
    expect(() => removeLocalStorage('app_theme')).not.toThrow();
  });

  it('survives localStorage being absent entirely', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readLocalStorage('app_theme')).toBeNull();
    expect(() => writeLocalStorage('app_theme', 'dark')).not.toThrow();
    expect(() => removeLocalStorage('app_theme')).not.toThrow();
  });
});
