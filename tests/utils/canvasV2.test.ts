import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMigratedWorkZoneCanvasIds,
  isCanvasV2Enabled,
  markCanvasWorkZoneMigrated,
  setCanvasV2Enabled,
} from '../../src/utils/canvasV2';

const V2_KEY = 'spoor.canvasV2Enabled';
const MIGRATED_KEY = 'spoor.migratedWorkZoneCanvasIds';

describe('canvasV2 flags', () => {
  beforeEach(() => {
    localStorage.removeItem(V2_KEY);
    localStorage.removeItem(MIGRATED_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(V2_KEY);
    localStorage.removeItem(MIGRATED_KEY);
  });

  it('defaults V2 on when localStorage key is absent', () => {
    expect(isCanvasV2Enabled()).toBe(true);
  });

  it('respects explicit V2 toggle', () => {
    setCanvasV2Enabled(false);
    expect(isCanvasV2Enabled()).toBe(false);
    setCanvasV2Enabled(true);
    expect(isCanvasV2Enabled()).toBe(true);
  });

  it('tracks migrated canvas ids', () => {
    expect(getMigratedWorkZoneCanvasIds().size).toBe(0);
    markCanvasWorkZoneMigrated('canvas-a');
    markCanvasWorkZoneMigrated('canvas-b');
    const ids = getMigratedWorkZoneCanvasIds();
    expect(ids.has('canvas-a')).toBe(true);
    expect(ids.has('canvas-b')).toBe(true);
  });
});
