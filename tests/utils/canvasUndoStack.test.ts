import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  applyCanvasUndo,
  createCanvasUndoStack,
} from '../../src/utils/canvasUndoStack';

const zone = {
  id: 'zone-1',
  canvasId: 'c',
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  createdAt: 1,
};

describe('canvasUndoStack', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvasWorkZones.clear();
  });

  it('caps stack length', () => {
    const stack = createCanvasUndoStack(2);
    stack.push({ type: 'paste', nodeIds: ['1'], edgeIds: [] });
    stack.push({ type: 'paste', nodeIds: ['2'], edgeIds: [] });
    stack.push({ type: 'paste', nodeIds: ['3'], edgeIds: [] });
    expect(stack.size).toBe(2);
    expect(stack.pop()).toEqual({ type: 'paste', nodeIds: ['3'], edgeIds: [] });
    expect(stack.pop()).toEqual({ type: 'paste', nodeIds: ['2'], edgeIds: [] });
    expect(stack.pop()).toBeUndefined();
  });

  it('undo delete restores nodes and edges', async () => {
    const nodes = [
      { id: 'n1', canvasId: 'c', type: 'text', content: 'a', x: 0, y: 0 },
      { id: 'n2', canvasId: 'c', type: 'ai', content: 'b', x: 10, y: 10 },
    ];
    const edges = [{ id: 'e1', canvasId: 'c', from: 'n1', to: 'n2' }];
    const stack = createCanvasUndoStack();
    stack.push({ type: 'delete', nodes, edges });

    const entry = stack.pop()!;
    await applyCanvasUndo(entry);

    expect(await db.nodes.toArray()).toHaveLength(2);
    expect(await db.edges.toArray()).toEqual([
      expect.objectContaining({ id: 'e1', from: 'n1', to: 'n2' }),
    ]);
  });

  it('undo paste removes created nodes and edges', async () => {
    await db.nodes.bulkAdd([
      { id: 'p1', canvasId: 'c', type: 'text', content: 'x', x: 0, y: 0 },
      { id: 'keep', canvasId: 'c', type: 'text', content: 'y', x: 1, y: 1 },
    ]);
    await db.edges.add({ id: 'pe1', canvasId: 'c', from: 'p1', to: 'keep' });

    const stack = createCanvasUndoStack();
    stack.push({ type: 'paste', nodeIds: ['p1'], edgeIds: ['pe1'] });
    await applyCanvasUndo(stack.pop()!);

    const remainingNodes = await db.nodes.toArray();
    expect(remainingNodes.map((n) => n.id)).toEqual(['keep']);
    expect(await db.edges.toArray()).toHaveLength(0);
  });

  it('undo work-zone create removes the room', async () => {
    await db.canvasWorkZones.add(zone);
    await applyCanvasUndo({ type: 'workZoneCreate', zoneId: zone.id });
    expect(await db.canvasWorkZones.get(zone.id)).toBeUndefined();
  });

  it('undo work-zone move restores the previous rect', async () => {
    await db.canvasWorkZones.add({ ...zone, x: 40, y: 60, width: 120, height: 90 });
    await applyCanvasUndo({ type: 'workZoneUpdate', before: zone });
    expect(await db.canvasWorkZones.get(zone.id)).toEqual(zone);
  });

  it('undo work-zone delete restores the room', async () => {
    await applyCanvasUndo({ type: 'workZoneDelete', zone });
    expect(await db.canvasWorkZones.get(zone.id)).toEqual(zone);
  });
});
