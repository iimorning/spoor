import type { CanvasNode, Edge } from '../db';
import {
  buildStickyClipboardPayload,
  isTextEditingTarget,
  parseStickyClipboardPayload,
  stickyPastePosition,
  STICKY_CLIPBOARD_KIND,
  type StickyClipboardPayloadV1,
} from './noteClipboard';
import type { CanvasTransformLike } from './canvas';
import { estimateNodeRect } from './canvas';
import { stampNewCard } from './stampNewCard';

export { isTextEditingTarget };

export const CANVAS_CLIPBOARD_KIND = 'scribe-canvas-v2' as const;

const PASTE_OFFSET = 24;

/** Node fields that may point at other canvas node ids and should be remapped on paste. */
const REMAP_ID_KEYS = [
  'threadRootContextNodeId',
  'webSearchParentId',
  'bookExpandParentId',
] as const;

export type CanvasClipboardNodeV2 = Omit<CanvasNode, 'id' | 'canvasId'> & {
  /** Original id used only for edge remapping inside the payload. */
  key: string;
};

export type CanvasClipboardEdgeV2 = {
  fromKey: string;
  toKey: string;
  note?: string;
};

export type CanvasClipboardPayloadV2 = {
  kind: typeof CANVAS_CLIPBOARD_KIND;
  nodes: CanvasClipboardNodeV2[];
  edges: CanvasClipboardEdgeV2[];
};

export type CanvasClipboardPayload = CanvasClipboardPayloadV2 | StickyClipboardPayloadV1;

function cloneNodeForClipboard(n: CanvasNode): CanvasClipboardNodeV2 {
  const { id, canvasId: _canvasId, turtleSoupRound: _hidden, ...rest } = n;
  return { ...rest, key: id };
}

export function buildCanvasClipboardPayload(
  nodes: CanvasNode[],
  edges: Edge[],
): CanvasClipboardPayloadV2 | null {
  if (nodes.length === 0) return null;
  const idSet = new Set(nodes.map((n) => n.id));
  return {
    kind: CANVAS_CLIPBOARD_KIND,
    nodes: nodes.map(cloneNodeForClipboard),
    edges: edges
      .filter((e) => idSet.has(e.from) && idSet.has(e.to))
      .map((e) => ({
        fromKey: e.from,
        toKey: e.to,
        ...(typeof e.note === 'string' && e.note.trim() ? { note: e.note.trim() } : {}),
      })),
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function parseCanvasClipboardPayload(raw: string): CanvasClipboardPayload | null {
  const v1 = parseStickyClipboardPayload(raw);
  if (v1) return v1;

  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    const rec = o as Record<string, unknown>;
    if (rec.kind !== CANVAS_CLIPBOARD_KIND || !Array.isArray(rec.nodes)) return null;

    // Per-node validation rather than whole-payload reject: a single corrupt
    // card used to silently abort paste, leaving the user with no fallback.
    // Now we skip bad rows and continue; edges that no longer reference a
    // surviving node key get dropped by the keySet check below.
    const nodes: CanvasClipboardNodeV2[] = [];
    for (const item of rec.nodes) {
      if (!item || typeof item !== 'object') continue;
      const n = item as Record<string, unknown>;
      if (typeof n.type !== 'string' || !n.type) continue;
      if (!isFiniteNumber(n.x) || !isFiniteNumber(n.y)) continue;
      const key = typeof n.key === 'string' && n.key ? n.key : crypto.randomUUID();
      const copy = { ...(n as object) } as Record<string, unknown>;
      delete copy.id;
      delete copy.canvasId;
      delete copy.key;
      nodes.push({
        ...(copy as Omit<CanvasClipboardNodeV2, 'key' | 'type' | 'x' | 'y'>),
        key,
        type: n.type,
        x: n.x,
        y: n.y,
      });
    }
    if (nodes.length === 0) return null;

    const keySet = new Set(nodes.map((n) => n.key));
    const edges: CanvasClipboardEdgeV2[] = [];
    if (Array.isArray(rec.edges)) {
      for (const item of rec.edges) {
        if (!item || typeof item !== 'object') continue;
        const e = item as Record<string, unknown>;
        if (typeof e.fromKey !== 'string' || typeof e.toKey !== 'string') continue;
        if (!keySet.has(e.fromKey) || !keySet.has(e.toKey)) continue;
        const note = typeof e.note === 'string' ? e.note.trim() : undefined;
        edges.push({
          fromKey: e.fromKey,
          toKey: e.toKey,
          ...(note ? { note } : {}),
        });
      }
    }

    return { kind: CANVAS_CLIPBOARD_KIND, nodes, edges };
  } catch {
    return null;
  }
}

function materializeV1(
  payload: StickyClipboardPayloadV1,
  canvasId: string,
): { nodes: CanvasNode[]; edges: Edge[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const nodes: CanvasNode[] = payload.nodes.map((item) => {
    const id = crypto.randomUUID();
    const { x, y } = stickyPastePosition(item);
    return stampNewCard({
      id,
      canvasId,
      type: item.type,
      content: item.content ?? '',
      layout: item.layout,
      width: item.width,
      height: item.height,
      rotation: item.rotation,
      x,
      y,
    });
  });
  return { nodes, edges: [], idMap };
}

function materializeV2(
  payload: CanvasClipboardPayloadV2,
  canvasId: string,
): { nodes: CanvasNode[]; edges: Edge[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  for (const n of payload.nodes) {
    idMap.set(n.key, crypto.randomUUID());
  }

  const nodes: CanvasNode[] = payload.nodes.map((n) => {
    const { key, ...rest } = n;
    const next: CanvasNode = stampNewCard({
      ...rest,
      id: idMap.get(key)!,
      canvasId,
      x: n.x + PASTE_OFFSET,
      y: n.y + PASTE_OFFSET,
    });

    for (const field of REMAP_ID_KEYS) {
      const val = next[field];
      if (typeof val === 'string') {
        const mapped = idMap.get(val);
        if (mapped) next[field] = mapped;
      }
    }

    if (Array.isArray(next.threadContextImageNodeIds)) {
      next.threadContextImageNodeIds = next.threadContextImageNodeIds.map(
        (id) => idMap.get(id) ?? id,
      );
    }

    return next;
  });

  const edges: Edge[] = payload.edges.map((e) => ({
    id: crypto.randomUUID(),
    canvasId,
    from: idMap.get(e.fromKey)!,
    to: idMap.get(e.toKey)!,
    ...(typeof e.note === 'string' && e.note.trim() ? { note: e.note.trim() } : {}),
  }));

  return { nodes, edges, idMap };
}

/** Turn a clipboard payload into DB rows with fresh ids and paste offset. */
export function materializeCanvasPaste(
  payload: CanvasClipboardPayload,
  canvasId: string,
): { nodes: CanvasNode[]; edges: Edge[]; idMap: Map<string, string> } {
  if (payload.kind === STICKY_CLIPBOARD_KIND) {
    return materializeV1(payload, canvasId);
  }
  return materializeV2(payload, canvasId);
}

/**
 * If the pasted bbox center is outside the current viewport, translate all
 * nodes so the bbox center lands at the viewport center (with the same
 * upper-left bias as {@link getCanvasCenterPosition} so a single card doesn't
 * sit directly under the toolbar). Preserves relative positions between nodes.
 *
 * When the bbox center is already inside the viewport, returns `rows`
 * unchanged so the existing "small +24 offset for repeated pastes" behavior
 * is preserved.
 */
const RECENTER_MARGIN_PX = 80;
const RECENTER_BIAS_X = 150;
const RECENTER_BIAS_Y = 100;

export function recenterNodesToViewport(
  rows: CanvasNode[],
  transform: CanvasTransformLike,
  viewport: { width: number; height: number },
): CanvasNode[] {
  if (rows.length === 0) return rows;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of rows) {
    const r = estimateNodeRect(n);
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  if (!Number.isFinite(minX)) return rows;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const scale = transform.scale || 1;
  const viewMinX = -transform.x / scale;
  const viewMinY = -transform.y / scale;
  const viewMaxX = (viewport.width - transform.x) / scale;
  const viewMaxY = (viewport.height - transform.y) / scale;
  const margin = RECENTER_MARGIN_PX / scale;

  const insideViewport =
    cx >= viewMinX + margin &&
    cx <= viewMaxX - margin &&
    cy >= viewMinY + margin &&
    cy <= viewMaxY - margin;
  if (insideViewport) return rows;

  const targetX = (viewport.width / 2 - transform.x) / scale - RECENTER_BIAS_X;
  const targetY = (viewport.height / 2 - transform.y) / scale - RECENTER_BIAS_Y;

  const dx = targetX - cx;
  const dy = targetY - cy;
  return rows.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
}

/** Snapshot nodes + any edges touching them (for delete/cut undo). */
export function snapshotNodesAndTouchingEdges(
  nodeIds: Iterable<string>,
  allNodes: CanvasNode[],
  allEdges: Edge[],
): { nodes: CanvasNode[]; edges: Edge[] } {
  const idSet = new Set(nodeIds);
  const nodes = allNodes.filter((n) => idSet.has(n.id)).map((n) => ({ ...n }));
  const edges = allEdges
    .filter((e) => idSet.has(e.from) || idSet.has(e.to))
    .map((e) => ({ ...e }));
  return { nodes, edges };
}

/** @deprecated Prefer buildCanvasClipboardPayload; kept for sticky-only callers/tests. */
export { buildStickyClipboardPayload, parseStickyClipboardPayload, STICKY_CLIPBOARD_KIND };
