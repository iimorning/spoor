import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * Regression for the Safari "site will not open" bug: the i18n module reads
 * `app_language` at import time — before React mounts — so an unguarded
 * localStorage access aborts the entire entry bundle and the user is left on the
 * `#spoor-boot` spinner with no error UI. Reading a language preference must
 * never be able to do that.
 *
 * Only this app's own keys throw: a blanket `Storage.prototype` spy also breaks
 * supabase-js's async session reads and yields unrelated unhandled rejections.
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
  vi.resetModules();
});

describe('i18n 初始化 · 存储被阻止', () => {
  it('读取语言偏好抛错时仍然完成初始化', async () => {
    blockAppStorageKeys();
    vi.resetModules();

    const mod = await import('../src/i18n');

    expect(mod.default).toBeDefined();
    expect(typeof mod.default.t).toBe('function');
    expect(['en', 'zh']).toContain(mod.default.language);
    // Importing the full i18n graph costs a few seconds (see tests/main.test.ts).
  }, 30_000);
});
