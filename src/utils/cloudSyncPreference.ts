import { isTauriRuntime } from './isTauriRuntime';

const STORAGE_KEY = 'spoor_cloud_sync_enabled';

export const CLOUD_SYNC_PREFERENCE_EVENT = 'spoor:cloud-sync-preference';

/** Desktop-only: users may opt out of cloud backup while staying signed in. */
export function canConfigureCloudSync(): boolean {
  return isTauriRuntime();
}

/** True when signed-in users should mirror canvas data to Supabase (default: on). */
export function readCloudSyncEnabled(): boolean {
  if (!canConfigureCloudSync()) return true;
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === '0' || raw === 'false') return false;
  return true;
}

export function writeCloudSyncEnabled(enabled: boolean): void {
  if (!canConfigureCloudSync()) return;
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_PREFERENCE_EVENT));
}