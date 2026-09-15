/** Suppresses Dexie auto-push hooks while applying post-upload local patches. */
let suppressDepth = 0;

export function isSyncHooksSuppressed(): boolean {
  return suppressDepth > 0;
}

export async function withoutSyncHooks<T>(fn: () => Promise<T>): Promise<T> {
  suppressDepth += 1;
  try {
    return await fn();
  } finally {
    suppressDepth -= 1;
  }
}
