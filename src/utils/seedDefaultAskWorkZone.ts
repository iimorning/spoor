import { db, type CanvasWorkZone } from '../db';
import type { CanvasTransformLike } from './canvas';
import { isCanvasV2Enabled } from './canvasV2';
import { loadCanvasViewport } from './canvasViewport';
import { computeDefaultAskWorkZoneRect } from './onboardingWorkroomLayout';
import { reconcileNodeScopesFromZones } from './syncWorkZoneScopes';
import { MIN_WORK_ZONE_SIZE_PX } from './workZoneGeometry';

export const DEFAULT_SEED_VIEWPORT = { width: 1280, height: 720 } as const;

/** Visible canvas area in world coordinates for a pan/zoom + host viewport. */
export function viewportWorldRect(
  transform: CanvasTransformLike,
  viewport: { width: number; height: number },
  padding = 0,
): { x: number; y: number; width: number; height: number } {
  const scale = transform.scale > 0 ? transform.scale : 1;
  const x = -transform.x / scale + padding;
  const y = -transform.y / scale + padding;
  const width = viewport.width / scale - padding * 2;
  const height = viewport.height / scale - padding * 2;
  return {
    x,
    y,
    width: Math.max(MIN_WORK_ZONE_SIZE_PX, width),
    height: Math.max(MIN_WORK_ZONE_SIZE_PX, height),
  };
}

export function readSeedViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { ...DEFAULT_SEED_VIEWPORT };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Seed one screen-sized work zone bound to the default Ask card when a canvas
 * has none yet. Skips when V2 is off or the user already drew rooms.
 */
export async function ensureDefaultAskWorkZone(opts: {
  canvasId: string;
  askNodeId: string;
  viewport?: { width: number; height: number };
}): Promise<CanvasWorkZone | null> {
  if (!isCanvasV2Enabled()) return null;

  const existing = await db.canvasWorkZones.where('canvasId').equals(opts.canvasId).count();
  if (existing > 0) return null;

  const ask = await db.nodes.get(opts.askNodeId);
  if (!ask || ask.canvasId !== opts.canvasId || ask.type !== 'ask') return null;

  const viewport = opts.viewport ?? readSeedViewportSize();
  const transform = loadCanvasViewport(opts.canvasId);
  const rect = computeDefaultAskWorkZoneRect(transform, viewport);

  const zone: CanvasWorkZone = {
    id: crypto.randomUUID(),
    canvasId: opts.canvasId,
    personaNodeId: opts.askNodeId,
    ...rect,
    createdAt: Date.now(),
  };
  await db.canvasWorkZones.add(zone);

  const nodes = await db.nodes.filter((n) => n.canvasId === opts.canvasId).toArray();
  await reconcileNodeScopesFromZones(nodes, [zone]);
  return zone;
}
