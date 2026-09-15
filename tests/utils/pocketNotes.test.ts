import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  POCKET_CANVAS_ID,
  createPocketNote,
  deletePocketNote,
  discardEmptyPocketNotes,
  isPocketCanvasId,
  isPocketNode,
  listPocketNotes,
  placePocketNoteOnCanvas,
  pocketNoteTitle,
  updatePocketNoteContent,
  formatPocketTime,
} from '../../src/utils/pocketNotes';

describe('pocketNotes', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.canvasWorkZones.clear();
    localStorage.clear();
  });

  it('create / update / list stay off the thinking canvas', async () => {
    const id = await createPocketNote('路上想到的一句');
    const node = await db.nodes.get(id);
    expect(node?.canvasId).toBe(POCKET_CANVAS_ID);
    expect(isPocketNode(node!)).toBe(true);
    expect(isPocketCanvasId(node?.canvasId)).toBe(true);

    await updatePocketNoteContent(id, '路上想到的一句\n回头再改');
    const listed = await listPocketNotes();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.content).toContain('回头再改');
    expect(pocketNoteTitle(listed[0]?.content)).toBe('路上想到的一句');
  });

  it('empty drafts are discarded except the one being edited', async () => {
    const keep = await createPocketNote('留下');
    const empty = await createPocketNote('   ');
    await discardEmptyPocketNotes(keep);
    expect(await db.nodes.get(keep)).toBeTruthy();
    expect(await db.nodes.get(empty)).toBeUndefined();
  });

  it('place moves the memo onto a real canvas and leaves the pocket', async () => {
    const id = await createPocketNote('钉上去');
    await db.nodes.add({
      id: 'obstacle',
      canvasId: 'board-1',
      type: 'note',
      content: 'already here',
      x: 100,
      y: 100,
    });

    const ok = await placePocketNoteOnCanvas({
      id,
      canvasId: 'board-1',
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [{ type: 'note', x: 100, y: 100, width: 320, height: 200 }],
    });
    expect(ok).toBe(true);
    const placed = await db.nodes.get(id);
    expect(placed?.canvasId).toBe('board-1');
    expect(isPocketNode(placed!)).toBe(false);
    expect(await listPocketNotes()).toHaveLength(0);
  });

  it('place stamps work-zone scope when the pin lands in a bound room', async () => {
    await db.canvasWorkZones.add({
      id: 'zone-a',
      canvasId: 'board-1',
      personaNodeId: 'agent-a',
      x: -2000,
      y: -2000,
      width: 8000,
      height: 8000,
      createdAt: 0,
    });
    const id = await createPocketNote('钉进房间');
    const ok = await placePocketNoteOnCanvas({
      id,
      canvasId: 'board-1',
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [],
    });
    expect(ok).toBe(true);
    expect((await db.nodes.get(id))?.contextScopeAgentId).toBe('agent-a');
  });

  it('refuses to place an empty memo or pin onto the pocket canvas', async () => {
    const emptyId = await createPocketNote('  ');
    expect(
      await placePocketNoteOnCanvas({
        id: emptyId,
        canvasId: 'board-1',
        transform: { x: 0, y: 0, scale: 1 },
        obstacles: [],
      }),
    ).toBe(false);

    const id = await createPocketNote('still pocket');
    expect(
      await placePocketNoteOnCanvas({
        id,
        canvasId: POCKET_CANVAS_ID,
        transform: { x: 0, y: 0, scale: 1 },
        obstacles: [],
      }),
    ).toBe(false);
    expect((await db.nodes.get(id))?.canvasId).toBe(POCKET_CANVAS_ID);
  });

  it('delete only removes pocket rows', async () => {
    const pocketId = await createPocketNote('bye');
    await db.nodes.add({
      id: 'canvas-note',
      canvasId: 'default',
      type: 'note',
      content: 'stay',
      x: 0,
      y: 0,
    });
    await deletePocketNote(pocketId);
    await deletePocketNote('canvas-note');
    expect(await db.nodes.get(pocketId)).toBeUndefined();
    expect(await db.nodes.get('canvas-note')).toBeTruthy();
  });
});

describe('formatPocketTime', () => {
  const now = new Date(2026, 8, 6, 15, 30); // 2026-09-06 15:30 local

  it('shows time only for notes created today', () => {
    const ms = new Date(2026, 8, 6, 12, 49).getTime();
    expect(formatPocketTime(ms, 'zh-CN', now)).toMatch(/12:49/);
    expect(formatPocketTime(ms, 'zh-CN', now)).not.toMatch(/月/);
  });

  it('shows date and time for notes from an earlier day this year', () => {
    const ms = new Date(2026, 8, 5, 9, 15).getTime();
    const label = formatPocketTime(ms, 'zh-CN', now);
    expect(label).toMatch(/9/);
    expect(label).toMatch(/5/);
    expect(label).toMatch(/09:15|9:15/);
    expect(label).not.toMatch(/2026/);
  });

  it('includes the year for notes from a previous year', () => {
    const ms = new Date(2025, 11, 31, 8, 0).getTime();
    const label = formatPocketTime(ms, 'zh-CN', now);
    expect(label).toMatch(/2025/);
    expect(label).toMatch(/31/);
  });
});
