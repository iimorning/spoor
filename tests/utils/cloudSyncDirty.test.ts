import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  clearCloudSyncDirty,
  clearCloudSyncDirtyAfterPush,
  getCloudSyncDirtyGeneration,
  isCloudSyncDirty,
  markCloudSyncDirty,
  needsCloudResumePush,
  readCloudSyncLastPushAt,
  resetCloudSyncDirtyForTests,
} from '../../src/utils/cloudSyncDirty';

describe('cloudSyncDirty', () => {
  beforeEach(async () => {
    resetCloudSyncDirtyForTests();
    await db.nodes.clear();
  });

  it('tracks dirty and clears after a successful push', () => {
    markCloudSyncDirty('u1');
    expect(isCloudSyncDirty('u1')).toBe(true);
    clearCloudSyncDirty('u1');
    expect(isCloudSyncDirty('u1')).toBe(false);
    expect(readCloudSyncLastPushAt('u1')).toMatch(/^\d{4}-/);
  });

  it('does not clear dirty when a new edit happened during push', () => {
    markCloudSyncDirty('u1');
    const genAtPushStart = getCloudSyncDirtyGeneration();
    markCloudSyncDirty('u1');
    expect(clearCloudSyncDirtyAfterPush('u1', genAtPushStart)).toBe(false);
    expect(isCloudSyncDirty('u1')).toBe(true);
    expect(readCloudSyncLastPushAt('u1')).toBeNull();
  });

  it('clears dirty when generation is unchanged after push', () => {
    markCloudSyncDirty('u1');
    const genAtPushStart = getCloudSyncDirtyGeneration();
    expect(clearCloudSyncDirtyAfterPush('u1', genAtPushStart)).toBe(true);
    expect(isCloudSyncDirty('u1')).toBe(false);
  });

  it('needs resume push when dirty', async () => {
    clearCloudSyncDirty('u1');
    markCloudSyncDirty('u1');
    await expect(needsCloudResumePush('u1')).resolves.toBe(true);
  });

  it('skips resume push when clean and already pushed before', async () => {
    clearCloudSyncDirty('u1');
    await db.nodes.add({ id: 'n1', canvasId: 'c1', type: 'note', x: 0, y: 0 });
    await expect(needsCloudResumePush('u1')).resolves.toBe(false);
  });

  it('needs resume push when never pushed but local nodes exist', async () => {
    await db.nodes.add({ id: 'n1', canvasId: 'c1', type: 'note', x: 0, y: 0 });
    await expect(needsCloudResumePush('u1')).resolves.toBe(true);
  });

  it('skips resume push when never pushed and local is empty', async () => {
    await expect(needsCloudResumePush('u1')).resolves.toBe(false);
  });

  it('needs resume push after localStorage was cleared but IndexedDB still has data', async () => {
    clearCloudSyncDirty('u1');
    resetCloudSyncDirtyForTests();
    await db.nodes.add({ id: 'n1', canvasId: 'c1', type: 'note', x: 0, y: 0 });
    await expect(needsCloudResumePush('u1')).resolves.toBe(true);
  });
});
