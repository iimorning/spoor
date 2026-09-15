/** Spoor V2: work-zone context, side-panel chat, excerpt-to-canvas. */

const V2_KEY = 'spoor.canvasV2Enabled';
const MIGRATED_CANVASES_KEY = 'spoor.migratedWorkZoneCanvasIds';

/** New installs default to V2 on (Phase 6). Set `localStorage` to `'false'` to disable. */
export function isCanvasV2Enabled(): boolean {
  const v = localStorage.getItem(V2_KEY);
  if (v === null) return true;
  return v === 'true';
}

export function setCanvasV2Enabled(enabled: boolean): void {
  localStorage.setItem(V2_KEY, enabled ? 'true' : 'false');
}

export function getMigratedWorkZoneCanvasIds(): Set<string> {
  try {
    const raw = localStorage.getItem(MIGRATED_CANVASES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function markCanvasWorkZoneMigrated(canvasId: string): void {
  const ids = getMigratedWorkZoneCanvasIds();
  ids.add(canvasId);
  localStorage.setItem(MIGRATED_CANVASES_KEY, JSON.stringify([...ids]));
}
