import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { deleteCanvasWithContents } from '../../src/utils/deleteCanvasWithContents';
import { encodeEssayContent } from '../../src/utils/essayPayload';
import { isAmbienceHiddenForCanvas, setAmbienceHiddenForCanvas } from '../../src/utils/ensureAmbienceNode';

describe('deleteCanvasWithContents', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.articles.clear();
    await db.canvasWorkZones.clear();
    await db.canvasPersonaThreads.clear();
  });

  it('deletes the canvas plus its nodes and edges, leaving other canvases intact', async () => {
    await db.canvases.bulkAdd([
      { id: 'keep', name: 'Keep', createdAt: 1, updatedAt: 1 },
      { id: 'gone', name: 'Gone', createdAt: 2, updatedAt: 2 },
    ]);
    await db.nodes.bulkAdd([
      { id: 'n-keep', canvasId: 'keep', type: 'note', content: 'A', x: 0, y: 0 },
      { id: 'n-gone', canvasId: 'gone', type: 'note', content: 'B', x: 0, y: 0 },
    ]);
    await db.edges.bulkAdd([
      { id: 'e-keep', canvasId: 'keep', from: 'n-keep', to: 'n-keep' },
      { id: 'e-gone', canvasId: 'gone', from: 'n-gone', to: 'n-gone' },
    ]);

    await deleteCanvasWithContents('gone');

    expect(await db.canvases.get('gone')).toBeUndefined();
    expect(await db.canvases.get('keep')).toBeDefined();
    expect(await db.nodes.get('n-gone')).toBeUndefined();
    expect(await db.nodes.get('n-keep')).toBeDefined();
    expect(await db.edges.get('e-gone')).toBeUndefined();
    expect(await db.edges.get('e-keep')).toBeDefined();
  });

  it('also removes legacy rows with empty canvasId when deleting the default canvas', async () => {
    await db.canvases.add({ id: 'default', name: 'Main', createdAt: 1, updatedAt: 1 });
    await db.nodes.bulkAdd([
      { id: 'legacy', type: 'note', content: 'old', x: 0, y: 0 },
      { id: 'empty', canvasId: '', type: 'note', content: 'empty', x: 0, y: 0 },
      { id: 'other', canvasId: 'other', type: 'note', content: 'keep', x: 0, y: 0 },
    ]);

    await deleteCanvasWithContents('default');

    expect(await db.nodes.get('legacy')).toBeUndefined();
    expect(await db.nodes.get('empty')).toBeUndefined();
    expect(await db.nodes.get('other')).toBeDefined();
  });

  it('deletes articles only referenced by essay cards on the removed canvas', async () => {
    await db.canvases.bulkAdd([
      { id: 'a', name: 'A', createdAt: 1, updatedAt: 1 },
      { id: 'b', name: 'B', createdAt: 2, updatedAt: 2 },
    ]);
    await db.articles.bulkAdd([
      { id: 'art-orphan', title: 'Orphan', content: '', date: '2026-01-01', type: 'essay' },
      { id: 'art-shared', title: 'Shared', content: '', date: '2026-01-01', type: 'essay' },
    ]);
    await db.nodes.bulkAdd([
      {
        id: 'essay-a',
        canvasId: 'a',
        type: 'essay',
        content: encodeEssayContent({ articleId: 'art-orphan' }),
        x: 0,
        y: 0,
      },
      {
        id: 'essay-b',
        canvasId: 'b',
        type: 'essay',
        content: encodeEssayContent({ articleId: 'art-shared' }),
        x: 0,
        y: 0,
      },
      {
        id: 'essay-a-shared',
        canvasId: 'a',
        type: 'essay',
        content: encodeEssayContent({ articleId: 'art-shared' }),
        x: 10,
        y: 0,
      },
    ]);

    await deleteCanvasWithContents('a');

    expect(await db.articles.get('art-orphan')).toBeUndefined();
    expect(await db.articles.get('art-shared')).toBeDefined();
  });

  it('clears the ambience hidden flag for that canvas', async () => {
    setAmbienceHiddenForCanvas('gone', true);
    await db.canvases.add({ id: 'gone', name: 'Gone', createdAt: 1, updatedAt: 1 });

    await deleteCanvasWithContents('gone');

    expect(isAmbienceHiddenForCanvas('gone')).toBe(false);
  });

  it('removes work zones and persona threads for that canvas only', async () => {
    await db.canvases.bulkAdd([
      { id: 'keep', name: 'Keep', createdAt: 1, updatedAt: 1 },
      { id: 'gone', name: 'Gone', createdAt: 2, updatedAt: 2 },
    ]);
    await db.canvasWorkZones.bulkAdd([
      {
        id: 'zone-keep',
        canvasId: 'keep',
        personaNodeId: 'ask-keep',
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        createdAt: 1,
      },
      {
        id: 'zone-gone',
        canvasId: 'gone',
        personaNodeId: 'ask-gone',
        x: 10,
        y: 10,
        width: 90,
        height: 90,
        createdAt: 2,
      },
    ]);
    await db.canvasPersonaThreads.bulkAdd([
      {
        id: 'keep:ask-keep',
        canvasId: 'keep',
        agentNodeId: 'ask-keep',
        messages: [{ id: 'm1', role: 'user', text: 'keep', createdAt: 1 }],
        updatedAt: 1,
      },
      {
        id: 'gone:ask-gone',
        canvasId: 'gone',
        agentNodeId: 'ask-gone',
        messages: [{ id: 'm2', role: 'user', text: 'gone', createdAt: 2 }],
        updatedAt: 2,
      },
    ]);

    await deleteCanvasWithContents('gone');

    expect(await db.canvasWorkZones.get('zone-gone')).toBeUndefined();
    expect(await db.canvasPersonaThreads.get('gone:ask-gone')).toBeUndefined();
    expect(await db.canvasWorkZones.get('zone-keep')).toBeDefined();
    expect(await db.canvasPersonaThreads.get('keep:ask-keep')).toBeDefined();
  });
});
