/** Serialized into CanvasNode.content for type="ambience". */

import { DEFAULT_AMBIENCE_SCENE_ID, resolveAmbienceSceneId } from '../data/ambienceCatalog';

export const AMBIENCE_CONTENT_PREFIX = 'spoor-ambience:v1:';

export const AMBIENCE_NODE_SIZE = { width: 220, height: 292 };

export interface AmbiencePayload {
  /** Active scene id from ambienceCatalog. */
  trackId: string;
  /** Master gain 0–1. */
  master: number;
  muted: boolean;
}

export const DEFAULT_AMBIENCE_PAYLOAD: AmbiencePayload = {
  trackId: DEFAULT_AMBIENCE_SCENE_ID,
  master: 1,
  muted: false,
};

export function encodeAmbienceContent(payload: AmbiencePayload): string {
  return AMBIENCE_CONTENT_PREFIX + JSON.stringify(payload);
}

export function tryParseAmbienceContent(content: string | undefined | null): AmbiencePayload | null {
  if (!content || !content.startsWith(AMBIENCE_CONTENT_PREFIX)) return null;
  try {
    const raw = JSON.parse(content.slice(AMBIENCE_CONTENT_PREFIX.length)) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return null;

    // v1 multi-layer → pick loudest track or default.
    let trackId = DEFAULT_AMBIENCE_PAYLOAD.trackId;
    if (typeof raw.trackId === 'string' && raw.trackId.trim()) {
      trackId = resolveAmbienceSceneId(raw.trackId.trim());
    } else if (raw.volumes && typeof raw.volumes === 'object') {
      let bestId = '';
      let bestVol = 0;
      for (const [id, v] of Object.entries(raw.volumes as Record<string, unknown>)) {
        if (typeof v === 'number' && v > bestVol) {
          bestVol = v;
          bestId = id;
        }
      }
      if (bestId) trackId = resolveAmbienceSceneId(bestId);
    }

    const master =
      typeof raw.master === 'number' && Number.isFinite(raw.master)
        ? Math.min(1, Math.max(0, raw.master))
        : DEFAULT_AMBIENCE_PAYLOAD.master;

    return {
      trackId,
      master,
      muted: !!raw.muted,
    };
  } catch {
    return null;
  }
}

export function parseAmbienceContentOrDefault(content: string | undefined | null): AmbiencePayload {
  return tryParseAmbienceContent(content) ?? { ...DEFAULT_AMBIENCE_PAYLOAD };
}
