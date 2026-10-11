import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * Same failure mode as tests/i18n.storageBlocked.test.ts, one layer up: `App.tsx`
 * reads its debug flag at module scope and `active_canvas_id` / `ai_config` /
 * the user-profile keys in the first render. Where script-writable storage is
 * blocked (Safari "Block All Cookies", non-persistent in-app webviews), merely
 * touching `localStorage` throws a SecurityError — a `typeof` check does not
 * help, because the property exists and its accessor throws. An unguarded read
 * on this path aborts the entry chunk, so the user never gets past `#spoor-boot`.
 *
 * Only this app's own keys throw: a blanket `Storage.prototype` spy also breaks
 * supabase-js's async session reads and yields unrelated unhandled rejections.
 */
const APP_STORAGE_KEYS = new Set([
  'SCRIBE_DEBUG_DND',
  'active_canvas_id',
  'ai_config',
  'user_name',
  'user_role',
  'user_avatar',
  'app_language',
  'app_theme',
  'canvas_grid',
]);
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

describe('App 启动 · 存储被阻止', () => {
  it('模块作用域读取被阻止时仍然可以导入', async () => {
    blockAppStorageKeys();
    vi.resetModules();

    const mod = await import('../src/App');

    expect(typeof mod.default).toBe('function');
    // Importing the full App graph costs a few seconds (see tests/main.test.ts).
  }, 30_000);
});
