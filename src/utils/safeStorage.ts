/**
 * `localStorage` access that survives environments where script-writable
 * storage is blocked — Safari's "Block All Cookies", private browsing on older
 * WebKit, and in-app webviews with a non-persistent data store. There, merely
 * *touching* `localStorage` throws a `SecurityError` (or `QuotaExceededError`
 * on write), and a `typeof` check does not help: the property exists, the
 * accessor throws.
 *
 * The startup path (`src/main.tsx`) reads these preferences at module scope,
 * before React mounts, so an uncaught throw aborts the whole bundle and leaves
 * the user on the `#spoor-boot` spinner with no error UI. Always go through
 * these helpers for non-critical preferences.
 */

export function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Best-effort write. A blocked or full store just means the choice won't persist. */
export function writeLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function removeLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}
