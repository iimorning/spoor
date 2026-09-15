/** Survives the Google OAuth redirect so the returning tab merges like email login. */
export const PENDING_LOGIN_MERGE_KEY = 'spoor_pending_login_merge';

const PENDING = '1';
const IN_FLIGHT = 'inflight';

export function markPendingLoginMerge(): void {
  try {
    sessionStorage.setItem(PENDING_LOGIN_MERGE_KEY, PENDING);
  } catch {
    /* private mode */
  }
}

export function clearPendingLoginMerge(): void {
  try {
    sessionStorage.removeItem(PENDING_LOGIN_MERGE_KEY);
  } catch {
    /* private mode */
  }
}

export function hasPendingLoginMerge(): boolean {
  try {
    const value = sessionStorage.getItem(PENDING_LOGIN_MERGE_KEY);
    return value === PENDING || value === IN_FLIGHT;
  } catch {
    return false;
  }
}

/**
 * Explicit login / OAuth return: keep the flag through React StrictMode remount
 * so a second BOOTSTRAP still merges instead of resume-pushing.
 */
export function takeLoginSyncMode(): 'login' | 'resume' {
  try {
    const value = sessionStorage.getItem(PENDING_LOGIN_MERGE_KEY);
    if (value === PENDING || value === IN_FLIGHT) {
      sessionStorage.setItem(PENDING_LOGIN_MERGE_KEY, IN_FLIGHT);
      return 'login';
    }
  } catch {
    /* private mode */
  }
  return 'resume';
}
