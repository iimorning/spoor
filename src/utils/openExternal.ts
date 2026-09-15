import { isTauriRuntime } from './isTauriRuntime';

/** Open URL in system browser (Tauri) or new tab (browser dev). */
export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    console.warn('[Spoor] openExternalUrl skipped non-http(s) URL');
    return;
  }

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external_url', { url: trimmed });
    return;
  }

  window.open(trimmed, '_blank', 'noopener,noreferrer');
}

/**
 * Waffo checkout must not use `window.open` after an `await`: browsers treat
 * that as a non-gesture popup and silently block it (looks like a dead click).
 * Same-tab navigation keeps the user gesture chain and returns via successUrl.
 */
export async function openCheckoutUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('waffo_no_checkout_url');
  }

  if (isTauriRuntime()) {
    await openExternalUrl(trimmed);
    return;
  }

  window.location.assign(trimmed);
}
