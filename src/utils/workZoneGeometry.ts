import type { CanvasWorkZone } from '../db';
import type { CanvasNode } from '../db';
import type { CanvasRect } from './canvas';
import { estimateNodeRect } from './canvas';

export const MIN_WORK_ZONE_SIZE_PX = 48;

export function worldRectFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  minSize = MIN_WORK_ZONE_SIZE_PX,
): CanvasRect | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < minSize || height < minSize) return null;
  return { x, y, width, height };
}

export function nodeCenter(node: CanvasNode): { x: number; y: number } {
  const rect = estimateNodeRect(node);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function isPointInRect(
  x: number,
  y: number,
  rect: CanvasRect,
): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function isNodeCenterInRect(node: CanvasNode, rect: CanvasRect): boolean {
  const center = nodeCenter(node);
  return isPointInRect(center.x, center.y, rect);
}

export function isNodeInWorkZone(node: CanvasNode, zone: CanvasWorkZone): boolean {
  return isNodeCenterInRect(node, zone);
}

export function zoneArea(zone: CanvasRect): number {
  return zone.width * zone.height;
}

/**
 * Which persona owns this node based on drawn work zones.
 * When zones overlap, the smallest area wins.
 */
export function findPersonaForNodeInZones(
  node: CanvasNode,
  zones: CanvasWorkZone[],
): string | undefined {
  const hits = zones.filter((zone) => zone.personaNodeId && isNodeInWorkZone(node, zone));
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => zoneArea(a) - zoneArea(b));
  return hits[0]?.personaNodeId;
}

export function findInnermostWorkZone(
  node: CanvasNode,
  zones: CanvasWorkZone[],
): CanvasWorkZone | null {
  const hits = zones.filter((zone) => isNodeInWorkZone(node, zone));
  if (hits.length === 0) return null;
  hits.sort((a, b) => zoneArea(a) - zoneArea(b));
  return hits[0] ?? null;
}

export type WorkZoneResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const WORK_ZONE_RESIZE_HANDLES: WorkZoneResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

export function workZoneHandleSizeWorld(scale: number): number {
  return 10 / (scale > 0 ? scale : 1);
}

export function workZoneHandleCenters(
  rect: CanvasRect,
): Record<WorkZoneResizeHandle, { x: number; y: number }> {
  const { x, y, width, height } = rect;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: y + height / 2 },
    se: { x: x + width, y: y + height },
    s: { x: x + width / 2, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: y + height / 2 },
  };
}

export function workZoneResizeCursor(handle: WorkZoneResizeHandle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    default:
      return 'nwse-resize';
  }
}

export function hitTestWorkZoneHandle(
  rect: CanvasRect,
  world: { x: number; y: number },
  scale: number,
): WorkZoneResizeHandle | null {
  const threshold = workZoneHandleSizeWorld(scale) * 1.35;
  const centers = workZoneHandleCenters(rect);
  let best: WorkZoneResizeHandle | null = null;
  let bestDist = Infinity;
  for (const handle of WORK_ZONE_RESIZE_HANDLES) {
    const center = centers[handle];
    const dist = Math.hypot(world.x - center.x, world.y - center.y);
    if (dist <= threshold && dist < bestDist) {
      best = handle;
      bestDist = dist;
    }
  }
  return best;
}

export function hitTestWorkZoneResize(
  zones: CanvasWorkZone[],
  world: { x: number; y: number },
  scale: number,
  preferredZoneId?: string | null,
): { zoneId: string; handle: WorkZoneResizeHandle } | null {
  const preferred = preferredZoneId
    ? zones.find((zone) => zone.id === preferredZoneId)
    : undefined;
  const rest = zones.filter((zone) => zone.id !== preferred?.id);
  rest.sort((a, b) => zoneArea(a) - zoneArea(b));
  const ordered = preferred ? [preferred, ...rest] : rest;
  for (const zone of ordered) {
    const handle = hitTestWorkZoneHandle(zone, world, scale);
    if (handle) return { zoneId: zone.id, handle };
  }
  return null;
}

/** Stretch a work zone from a handle; opposite edges stay fixed and size stays ≥ minSize. */
export function resizeWorkZoneRect(
  rect: CanvasRect,
  handle: WorkZoneResizeHandle,
  world: { x: number; y: number },
  minSize = MIN_WORK_ZONE_SIZE_PX,
): CanvasRect {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let x = rect.x;
  let y = rect.y;
  let r = right;
  let b = bottom;

  if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    x = Math.min(world.x, r - minSize);
  }
  if (handle === 'e' || handle === 'ne' || handle === 'se') {
    r = Math.max(world.x, x + minSize);
  }
  if (handle === 'n' || handle === 'nw' || handle === 'ne') {
    y = Math.min(world.y, b - minSize);
  }
  if (handle === 's' || handle === 'sw' || handle === 'se') {
    b = Math.max(world.y, y + minSize);
  }

  return { x, y, width: r - x, height: b - y };
}

export function translateWorkZoneRect(
  rect: CanvasRect,
  dx: number,
  dy: number,
): CanvasRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

export function hitTestWorkZoneBody(
  zones: CanvasWorkZone[],
  world: { x: number; y: number },
  preferredZoneId?: string | null,
): CanvasWorkZone | null {
  const hits = zones.filter((zone) => isPointInRect(world.x, world.y, zone));
  if (hits.length === 0) return null;
  if (preferredZoneId) {
    const preferred = hits.find((zone) => zone.id === preferredZoneId);
    if (preferred) return preferred;
  }
  hits.sort((a, b) => zoneArea(a) - zoneArea(b));
  return hits[0] ?? null;
}

/** Bound-room empty click opens that persona's chat; otherwise dismiss chat. */
export function personaIdForEmptyCanvasClick(
  zones: CanvasWorkZone[],
  world: { x: number; y: number },
  preferredZoneId?: string | null,
): string | null {
  return hitTestWorkZoneBody(zones, world, preferredZoneId)?.personaNodeId ?? null;
}

export function workZoneRectsEqual(
  a: CanvasRect,
  b: CanvasRect,
  epsilon = 0.05,
): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
