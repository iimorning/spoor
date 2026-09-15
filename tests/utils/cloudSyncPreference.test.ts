import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  readCloudSyncEnabled,
  writeCloudSyncEnabled,
} from '../../src/utils/cloudSyncPreference';

const isTauriRuntimeMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../src/utils/isTauriRuntime', () => ({
  isTauriRuntime: isTauriRuntimeMock,
}));

describe('cloudSyncPreference', () => {
  beforeEach(() => {
    localStorage.clear();
    isTauriRuntimeMock.mockReturnValue(false);
  });

  it('always enables cloud sync in the browser build', () => {
    localStorage.setItem('spoor_cloud_sync_enabled', '0');
    expect(readCloudSyncEnabled()).toBe(true);
    writeCloudSyncEnabled(false);
    expect(localStorage.getItem('spoor_cloud_sync_enabled')).toBe('0');
    expect(readCloudSyncEnabled()).toBe(true);
  });

  it('respects the preference on desktop', () => {
    isTauriRuntimeMock.mockReturnValue(true);
    expect(readCloudSyncEnabled()).toBe(true);
    writeCloudSyncEnabled(false);
    expect(readCloudSyncEnabled()).toBe(false);
    writeCloudSyncEnabled(true);
    expect(readCloudSyncEnabled()).toBe(true);
  });
});
