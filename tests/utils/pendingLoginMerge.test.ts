import { describe, it, expect, beforeEach } from 'vitest';
import {
  PENDING_LOGIN_MERGE_KEY,
  clearPendingLoginMerge,
  hasPendingLoginMerge,
  markPendingLoginMerge,
  takeLoginSyncMode,
} from '../../src/utils/pendingLoginMerge';

describe('pendingLoginMerge', () => {
  beforeEach(() => {
    sessionStorage.removeItem(PENDING_LOGIN_MERGE_KEY);
  });

  it('defaults to resume', () => {
    expect(takeLoginSyncMode()).toBe('resume');
  });

  it('stays on login across a remount until cleared', () => {
    markPendingLoginMerge();
    expect(takeLoginSyncMode()).toBe('login');
    expect(takeLoginSyncMode()).toBe('login');
    expect(sessionStorage.getItem(PENDING_LOGIN_MERGE_KEY)).toBe('inflight');
    clearPendingLoginMerge();
    expect(takeLoginSyncMode()).toBe('resume');
  });

  it('hasPendingLoginMerge is true for pending and inflight', () => {
    expect(hasPendingLoginMerge()).toBe(false);
    markPendingLoginMerge();
    expect(hasPendingLoginMerge()).toBe(true);
    takeLoginSyncMode();
    expect(hasPendingLoginMerge()).toBe(true);
    clearPendingLoginMerge();
    expect(hasPendingLoginMerge()).toBe(false);
  });
});
