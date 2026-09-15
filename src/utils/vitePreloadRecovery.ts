const PRELOAD_RELOAD_KEY = 'spoor:vite-preload-reload';

type VitePreloadErrorEvent = Event & {
  payload?: unknown;
};

function errorFingerprint(payload: unknown): string {
  if (payload instanceof Error) return payload.message || payload.name;
  return String(payload ?? 'unknown-preload-error');
}

export function recoverFromVitePreloadError(
  event: VitePreloadErrorEvent,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean {
  const fingerprint = errorFingerprint(event.payload);
  try {
    if (storage.getItem(PRELOAD_RELOAD_KEY) === fingerprint) return false;
    storage.setItem(PRELOAD_RELOAD_KEY, fingerprint);
  } catch {
    return false;
  }

  event.preventDefault();
  reload();
  return true;
}

export function registerVitePreloadRecovery(target: Window = window): void {
  target.addEventListener('vite:preloadError', (event) => {
    recoverFromVitePreloadError(event as VitePreloadErrorEvent);
  });
}
