import { db } from '../db';

const DIRTY_PREFIX = 'spoor_cloud_sync_dirty:';
const LAST_PUSH_PREFIX = 'spoor_cloud_sync_last_push:';

/** In-memory generation: bumps on every local edit (survives concurrent push). */
let dirtyGeneration = 0;

function dirtyKey(userId: string) {
  return `${DIRTY_PREFIX}${userId}`;
}

function lastPushKey(userId: string) {
  return `${LAST_PUSH_PREFIX}${userId}`;
}

export function getCloudSyncDirtyGeneration(): number {
  return dirtyGeneration;
}

export function markCloudSyncDirty(userId: string): void {
  dirtyGeneration += 1;
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(dirtyKey(userId), '1');
  } catch {
    /* private mode */
  }
}

export function isCloudSyncDirty(userId: string): boolean {
  if (!userId || typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(dirtyKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function readCloudSyncLastPushAt(userId: string): string | null {
  if (!userId || typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(lastPushKey(userId));
  } catch {
    return null;
  }
}

/** Call after a successful cloud push for this user. */
export function clearCloudSyncDirty(userId: string): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(dirtyKey(userId));
    localStorage.setItem(lastPushKey(userId), new Date().toISOString());
  } catch {
    /* private mode */
  }
}

/**
 * Clear dirty only if no new local edits happened while the push was in flight.
 * Returns true when the dirty flag was cleared.
 */
export function clearCloudSyncDirtyAfterPush(userId: string, generationAtPushStart: number): boolean {
  if (dirtyGeneration !== generationAtPushStart) return false;
  clearCloudSyncDirty(userId);
  return true;
}

/**
 * Session resume should push only when local edits are pending, or we have
 * never successfully pushed this profile (upgrade / first sync after login).
 */
export async function needsCloudResumePush(userId: string): Promise<boolean> {
  if (!userId) return false;
  if (isCloudSyncDirty(userId)) return true;
  if (readCloudSyncLastPushAt(userId)) return false;
  return (await db.nodes.count()) > 0;
}

export function resetCloudSyncDirtyForTests(): void {
  dirtyGeneration = 0;
  if (typeof localStorage === 'undefined') return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(DIRTY_PREFIX) || key?.startsWith(LAST_PUSH_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}
