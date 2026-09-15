import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  ambienceFixturePosition,
  ensureAmbienceNodeForCanvas,
  isAmbienceFixtureNode,
  isAmbienceHiddenForCanvas,
  setAmbienceHiddenForCanvas,
} from '../../src/utils/ensureAmbienceNode';
import { AMBIENCE_NODE_SIZE } from '../../src/utils/ambiencePayload';

describe('ensureAmbienceNode helpers', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.nodes.clear();
  });

  it('recognizes ambience fixtures', () => {
    expect(isAmbienceFixtureNode('ambience')).toBe(true);
    expect(isAmbienceFixtureNode('ask')).toBe(false);
  });

  it('places the fixture near the bottom-left of the current view', () => {
    const pos = ambienceFixturePosition({ x: 0, y: 0, scale: 1 });
    expect(pos.x).toBe(28);
    expect(pos.y).toBe(Math.max(24, window.innerHeight - AMBIENCE_NODE_SIZE.height - 96));
  });

  it('accepts an explicit seed position for blank canvases', async () => {
    const id = await ensureAmbienceNodeForCanvas({
      canvasId: 'seeded',
      position: { x: 120, y: 460 },
    });
    expect(id).toBeTruthy();
    const row = await db.nodes.get(id!);
    expect(row).toMatchObject({ x: 120, y: 460 });
  });

  it('nudges an overlapping ambience away from virgin starter cards', async () => {
    await db.nodes.bulkAdd([
      { id: 'ask-1', canvasId: 'blank', type: 'ask', x: 100, y: 140, width: 320, height: 180 },
      { id: 'theme-1', canvasId: 'blank', type: 'theme', x: 500, y: 140, width: 320, height: 200 },
      { id: 'note-1', canvasId: 'blank', type: 'note', x: 900, y: 140, width: 320, height: 200 },
      {
        id: 'amb-1',
        canvasId: 'blank',
        type: 'ambience',
        x: 28,
        y: 200,
        width: AMBIENCE_NODE_SIZE.width,
        height: AMBIENCE_NODE_SIZE.height,
      },
    ]);
    await ensureAmbienceNodeForCanvas({ canvasId: 'blank' });
    const amb = await db.nodes.get('amb-1');
    expect(amb?.y).toBeGreaterThan(140 + 200);
    expect(amb?.x).toBe(100);
  });

  it('creates one fixture and reuses it on subsequent ensure', async () => {
    const a = await ensureAmbienceNodeForCanvas({ canvasId: 'c1' });
    const b = await ensureAmbienceNodeForCanvas({ canvasId: 'c1' });
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    const rows = await db.nodes.where('canvasId').equals('c1').toArray();
    expect(rows.filter((n) => n.type === 'ambience')).toHaveLength(1);
  });

  it('dedupes duplicate ambience rows down to one', async () => {
    await db.nodes.bulkAdd([
      { id: 'a1', canvasId: 'c1', type: 'ambience', x: 0, y: 0 },
      { id: 'a2', canvasId: 'c1', type: 'ambience', x: 100, y: 0 },
    ]);
    const kept = await ensureAmbienceNodeForCanvas({ canvasId: 'c1' });
    expect(kept).toBe('a1');
    const rows = await db.nodes.where('canvasId').equals('c1').toArray();
    expect(rows.filter((n) => n.type === 'ambience').map((n) => n.id)).toEqual(['a1']);
  });

  it('does not recreate after dismiss unless force', async () => {
    setAmbienceHiddenForCanvas('c1', true);
    expect(isAmbienceHiddenForCanvas('c1')).toBe(true);
    expect(await ensureAmbienceNodeForCanvas({ canvasId: 'c1' })).toBeNull();
    const forced = await ensureAmbienceNodeForCanvas({ canvasId: 'c1', force: true });
    expect(forced).toBeTruthy();
    expect(isAmbienceHiddenForCanvas('c1')).toBe(false);
  });

  it('serializes concurrent ensure calls so only one row is inserted', async () => {
    const [a, b] = await Promise.all([
      ensureAmbienceNodeForCanvas({ canvasId: 'race' }),
      ensureAmbienceNodeForCanvas({ canvasId: 'race' }),
    ]);
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    const rows = await db.nodes.where('canvasId').equals('race').toArray();
    expect(rows.filter((n) => n.type === 'ambience')).toHaveLength(1);
  });
});
