import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  collapsedNotePilePeerIds,
  expandSelectionWithNotePiles,
  maybeLeaveNotePile,
  notePileStackPos,
  notePileStackZIndex,
  notePileVisualIndex,
  pickNotePileSnapTarget,
  snapNodeOntoNode,
} from '../../src/services/notePile';
import { estimateNodeRect } from '../../src/utils/canvas';

describe('notePile', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('visual index puts the last writing card on top', () => {
    expect(notePileVisualIndex(0, 3)).toBe(2);
    expect(notePileVisualIndex(2, 3)).toBe(0);
    expect(notePileStackZIndex(0)).toBeGreaterThan(notePileStackZIndex(1));
  });

  it('snaps the dropped card on top and keeps the target first in writing order', async () => {
    await db.nodes.bulkAdd([
      { id: 'a', type: 'text', x: 20, y: 20, canvasId: 'default' },
      { id: 'b', type: 'text', x: 0, y: 0, canvasId: 'default' },
    ]);
    const nodes = await db.nodes.toArray();
    expect(await snapNodeOntoNode('a', 'b', nodes)).toBe(true);

    const [a, b] = await db.nodes.bulkGet(['a', 'b']);
    expect(b?.notePileMemberIds).toEqual(['b', 'a']);
    expect(b?.notePileCollapsed).toBe(true);
    expect(a?.notePileParentId).toBe('b');
    const top = notePileStackPos({ x: 0, y: 0 }, 0);
    const under = notePileStackPos({ x: 0, y: 0 }, 1);
    expect(a?.x).toBe(top.x);
    expect(b?.x).toBe(under.x);
    expect(a?.y).toBe(top.y);
    expect(b?.y).toBe(under.y);
  });

  it('appends a third card as the new top / last section', async () => {
    await db.nodes.bulkAdd([
      { id: 'a', type: 'text', x: 20, y: 20, canvasId: 'default' },
      { id: 'b', type: 'text', x: 0, y: 0, canvasId: 'default' },
      { id: 'c', type: 'text', x: 15, y: 15, canvasId: 'default' },
    ]);
    let nodes = await db.nodes.toArray();
    await snapNodeOntoNode('a', 'b', nodes);
    nodes = await db.nodes.toArray();
    await snapNodeOntoNode('c', 'b', nodes);

    const hub = await db.nodes.get('b');
    expect(hub?.notePileMemberIds).toEqual(['b', 'a', 'c']);
    const c = await db.nodes.get('c');
    expect(c?.x).toBe(notePileStackPos({ x: 0, y: 0 }, 0).x);
  });

  it('leaves the pile when dragged far away and dissolves a 2-card pile', async () => {
    await db.nodes.bulkAdd([
      { id: 'a', type: 'text', x: 20, y: 20, canvasId: 'default' },
      { id: 'b', type: 'text', x: 0, y: 0, canvasId: 'default' },
    ]);
    const nodes = await db.nodes.toArray();
    await snapNodeOntoNode('a', 'b', nodes);
    const stacked = await db.nodes.toArray();
    expect(await maybeLeaveNotePile('a', { x: 900, y: 900 }, stacked)).toBe(true);
    const [a, b] = await db.nodes.bulkGet(['a', 'b']);
    expect(a?.notePileParentId).toBeUndefined();
    expect(b?.notePileMemberIds).toBeUndefined();
  });

  it('expandSelectionWithNotePiles uses writing order when any member is selected', () => {
    const nodes = [
      {
        id: 'b',
        type: 'text' as const,
        x: 0,
        y: 0,
        notePileMemberIds: ['b', 'a', 'c'],
        notePileParentId: 'b',
        notePileCollapsed: true,
      },
      { id: 'a', type: 'text' as const, x: 0, y: 0, notePileParentId: 'b' },
      { id: 'c', type: 'text' as const, x: 0, y: 0, notePileParentId: 'c' },
    ];
    // c's parentId is wrong on purpose for the hub lookup via a
    nodes[2] = { ...nodes[2], notePileParentId: 'b' };
    expect(expandSelectionWithNotePiles(['a'], nodes)).toEqual(['b', 'a', 'c']);
  });

  it('collapsedNotePilePeerIds lists the whole stacked pile', () => {
    const nodes = [
      {
        id: 'b',
        type: 'text' as const,
        x: 0,
        y: 0,
        notePileMemberIds: ['b', 'a'],
        notePileParentId: 'b',
        notePileCollapsed: true,
      },
      { id: 'a', type: 'text' as const, x: 0, y: 0, notePileParentId: 'b' },
    ];
    expect(collapsedNotePilePeerIds('a', nodes)).toEqual(['b', 'a']);
  });

  it('pickNotePileSnapTarget ignores agents and needs a solid overlap', () => {
    const dragged = { id: 'a', type: 'text' as const, x: 0, y: 0 };
    const note = { id: 'b', type: 'text' as const, x: 10, y: 10 };
    const agent = { id: 'ag', type: 'agent' as const, x: 5, y: 5 };
    const hit = pickNotePileSnapTarget('a', estimateNodeRect(dragged), [dragged, note, agent], new Set());
    expect(hit?.id).toBe('b');
    const miss = pickNotePileSnapTarget(
      'a',
      estimateNodeRect({ ...dragged, x: 800, y: 800 }),
      [dragged, note],
      new Set(),
    );
    expect(miss).toBeNull();
  });
});
