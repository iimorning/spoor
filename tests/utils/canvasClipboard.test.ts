import { describe, it, expect } from 'vitest';
import {
  buildCanvasClipboardPayload,
  CANVAS_CLIPBOARD_KIND,
  materializeCanvasPaste,
  parseCanvasClipboardPayload,
  recenterNodesToViewport,
  snapshotNodesAndTouchingEdges,
} from '../../src/utils/canvasClipboard';
import { STICKY_CLIPBOARD_KIND } from '../../src/utils/noteClipboard';
import type { CanvasNode, Edge } from '../../src/db';

describe('canvasClipboard v2', () => {
  it('builds payload with nodes and internal edges only', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', type: 'ai', content: 'ans', userTurn: 'q', x: 0, y: 0 },
      { id: 'b', type: 'book', content: '{}', x: 10, y: 20, width: 380 },
      { id: 'c', type: 'theme', content: 'hub', x: 40, y: 50 },
    ];
    const edges: Edge[] = [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'a', to: 'outside' },
    ];
    const payload = buildCanvasClipboardPayload([nodes[0]!, nodes[1]!], edges);
    expect(payload?.kind).toBe(CANVAS_CLIPBOARD_KIND);
    expect(payload?.nodes).toHaveLength(2);
    expect(payload?.nodes.map((n) => n.key)).toEqual(['a', 'b']);
    expect(payload?.edges).toEqual([{ fromKey: 'a', toKey: 'b' }]);
    expect(payload?.nodes[0]).toMatchObject({ type: 'ai', userTurn: 'q', content: 'ans' });
  });

  it('materializePaste remaps ids, offsets position, and rebuilds edges', () => {
    const payload = buildCanvasClipboardPayload(
      [
        { id: 'a', type: 'text', content: 'one', x: 100, y: 200 },
        { id: 'b', type: 'ai', content: 'two', x: 140, y: 240, webSearchParentId: 'a' },
      ],
      [{ id: 'e1', from: 'a', to: 'b' }],
    )!;
    const { nodes, edges, idMap } = materializeCanvasPaste(payload, 'canvas-1');
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(idMap.size).toBe(2);
    expect(nodes[0]!.id).not.toBe('a');
    expect(nodes[0]!.canvasId).toBe('canvas-1');
    expect(nodes[0]!.x).toBe(124);
    expect(nodes[0]!.y).toBe(224);
    expect(nodes[1]!.webSearchParentId).toBe(nodes[0]!.id);
    expect(edges[0]!.from).toBe(nodes[0]!.id);
    expect(edges[0]!.to).toBe(nodes[1]!.id);
    expect(typeof nodes[0]!.createdAt).toBe('number');
    expect(typeof nodes[1]!.createdAt).toBe('number');
  });

  it('stamps createdAt on paste instead of keeping the source timestamp', () => {
    const old = 1_700_000_000_000;
    const payload = buildCanvasClipboardPayload(
      [{ id: 'a', type: 'text', content: 'one', x: 100, y: 200, createdAt: old }],
      [],
    )!;
    const before = Date.now();
    const { nodes } = materializeCanvasPaste(payload, 'canvas-1');
    const after = Date.now();
    expect(nodes[0]!.createdAt).not.toBe(old);
    expect(nodes[0]!.createdAt).toBeGreaterThanOrEqual(before);
    expect(nodes[0]!.createdAt).toBeLessThanOrEqual(after);
  });

  it('parses sticky v1 payloads for paste compatibility', () => {
    const raw = JSON.stringify({
      kind: STICKY_CLIPBOARD_KIND,
      nodes: [{ type: 'note', content: 'hi', x: 5, y: 6, layout: 1 }],
    });
    const parsed = parseCanvasClipboardPayload(raw);
    expect(parsed?.kind).toBe(STICKY_CLIPBOARD_KIND);
    const { nodes, edges } = materializeCanvasPaste(parsed!, 'c1');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'note', content: 'hi', x: 29, y: 30, canvasId: 'c1' });
    expect(typeof nodes[0]!.createdAt).toBe('number');
    expect(edges).toHaveLength(0);
  });

  it('snapshotNodesAndTouchingEdges includes edges to outside nodes', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', type: 'text', x: 0, y: 0 },
      { id: 'b', type: 'text', x: 1, y: 1 },
    ];
    const edges: Edge[] = [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'a', to: 'z' },
    ];
    const snap = snapshotNodesAndTouchingEdges(['a'], nodes, edges);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.edges.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('skips corrupt nodes instead of rejecting the whole payload', () => {
    const raw = JSON.stringify({
      kind: CANVAS_CLIPBOARD_KIND,
      nodes: [
        { type: 'text', x: 0, y: 0 },                   // ok
        null,                                            // bad: null item
        { type: '', x: 0, y: 0 },                       // bad: empty type
        { type: 'ai', x: 'NaN', y: 0 },                 // bad: non-number x
        { type: 'book', x: 10, y: 20, content: '{}' },  // ok
      ],
    });
    const parsed = parseCanvasClipboardPayload(raw);
    expect(parsed?.kind).toBe(CANVAS_CLIPBOARD_KIND);
    expect(parsed?.nodes).toHaveLength(2);
    expect(parsed?.nodes.map((n) => n.type)).toEqual(['text', 'book']);
  });
});

describe('recenterNodesToViewport', () => {
  const viewport = { width: 1000, height: 800 };

  it('returns rows unchanged when bbox center is inside the viewport', () => {
    const rows: CanvasNode[] = [
      { id: 'a', canvasId: 'c', type: 'text', x: 100, y: 100, width: 200, height: 100 },
    ];
    const transform = { x: 0, y: 0, scale: 1 };
    const result = recenterNodesToViewport(rows, transform, viewport);
    expect(result[0]?.x).toBe(100);
    expect(result[0]?.y).toBe(100);
  });

  it('translates far-away rows so the bbox center lands at the viewport center', () => {
    const rows: CanvasNode[] = [
      { id: 'a', canvasId: 'c', type: 'text', x: 5000, y: 5000, width: 200, height: 100 },
    ];
    const transform = { x: 0, y: 0, scale: 1 };
    const result = recenterNodesToViewport(rows, transform, viewport);
    // Viewport center with bias: (1000/2 - 150, 800/2 - 100) = (350, 300).
    // bbox center is (5100, 5050), so dx = -4750, dy = -4750.
    expect(result[0]?.x).toBe(250);
    expect(result[0]?.y).toBe(250);
  });

  it('preserves relative positions between nodes when re-centering', () => {
    const rows: CanvasNode[] = [
      { id: 'a', canvasId: 'c', type: 'text', x: 5000, y: 5000, width: 100, height: 50 },
      { id: 'b', canvasId: 'c', type: 'text', x: 5300, y: 5200, width: 100, height: 50 },
    ];
    const transform = { x: 0, y: 0, scale: 1 };
    const result = recenterNodesToViewport(rows, transform, viewport);
    expect(result[1]!.x - result[0]!.x).toBe(rows[1]!.x - rows[0]!.x);
    expect(result[1]!.y - result[0]!.y).toBe(rows[1]!.y - rows[0]!.y);
  });

  it('respects zoom when computing the viewport rect', () => {
    // Viewport 1000x800, scale 0.5 → canvas-visible area is (0,0) to (2000,1600).
    const inside: CanvasNode[] = [
      { id: 'a', canvasId: 'c', type: 'text', x: 1000, y: 800, width: 100, height: 50 },
    ];
    const transform = { x: 0, y: 0, scale: 0.5 };
    const result = recenterNodesToViewport(inside, transform, viewport);
    expect(result[0]?.x).toBe(1000);
    expect(result[0]?.y).toBe(800);
  });

  it('returns rows unchanged when input is empty', () => {
    const result = recenterNodesToViewport([], { x: 0, y: 0, scale: 1 }, viewport);
    expect(result).toEqual([]);
  });

  it('re-centers when zoom is very low and source nodes are at small coords', () => {
    // Zoomed way out (scale 0.1), viewport 1000x800 → canvas area is (0,0) to (10000, 8000).
    // Source node at (50, 50), bbox center (100, 75) → well inside, no move.
    // Now shift transform so viewport is around (20000, 20000): node falls outside.
    const rows: CanvasNode[] = [
      { id: 'a', canvasId: 'c', type: 'text', x: 50, y: 50, width: 100, height: 50 },
    ];
    const transform = { x: 20000, y: 20000, scale: 0.1 };
    const result = recenterNodesToViewport(rows, transform, viewport);
    expect(result[0]?.x).not.toBe(50);
    expect(result[0]?.y).not.toBe(50);
  });
});
