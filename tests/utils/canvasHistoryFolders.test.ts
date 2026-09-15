import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import type { Canvas, CanvasFolder } from '../../src/db';
import {
  applyCanvasFolderOrder,
  canvasesInFolder,
  createCanvasFolder,
  deleteCanvasFolder,
  hitTestHistoryDrop,
  persistCanvasHistoryDrop,
  plannedCanvasOrder,
  plannedFolderOrder,
  renameCanvasFolder,
  sortCanvasesForHistory,
} from '../../src/utils/canvasHistoryFolders';

function canvas(partial: Partial<Canvas> & Pick<Canvas, 'id' | 'name'>): Canvas {
  return { createdAt: 1, updatedAt: 1, ...partial };
}

describe('canvasHistoryFolders', () => {
  beforeEach(async () => {
    await db.canvases.clear();
    await db.canvasFolders.clear();
  });

  it('creates, renames, and deletes a folder without deleting canvases', async () => {
    const folder = await createCanvasFolder('  Work  ');
    expect(folder.name).toBe('Work');
    await db.canvases.add(canvas({ id: 'c1', name: 'A', folderId: folder.id }));
    await renameCanvasFolder(folder.id, 'Studio');
    expect((await db.canvasFolders.get(folder.id))?.name).toBe('Studio');
    await deleteCanvasFolder(folder.id);
    expect(await db.canvasFolders.count()).toBe(0);
    expect((await db.canvases.get('c1'))?.folderId).toBeUndefined();
  });

  it('sorts canvases by sortOrder when present', () => {
    const rows = [
      canvas({ id: 'c1', name: 'A', sortOrder: 2 }),
      canvas({ id: 'c2', name: 'B', sortOrder: 0 }),
      canvas({ id: 'c3', name: 'C', sortOrder: 1 }),
    ];
    expect(sortCanvasesForHistory(rows).map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('plans dropping a canvas into a folder at the end', () => {
    const folders: CanvasFolder[] = [{ id: 'f1', name: 'F', createdAt: 1, sortOrder: 0 }];
    const canvases = [
      canvas({ id: 'c1', name: 'A', folderId: 'f1', sortOrder: 0 }),
      canvas({ id: 'c2', name: 'B', sortOrder: 1 }),
    ];
    expect(
      plannedCanvasOrder({
        dragId: 'c2',
        target: { id: 'f1', kind: 'folder', edge: 'into' },
        canvases,
        folders,
      }),
    ).toEqual({ folderId: 'f1', ids: ['c1', 'c2'] });
  });

  it('plans reordering a canvas before a sibling', () => {
    const canvases = [
      canvas({ id: 'c1', name: 'A', sortOrder: 0 }),
      canvas({ id: 'c2', name: 'B', sortOrder: 1 }),
      canvas({ id: 'c3', name: 'C', sortOrder: 2 }),
    ];
    expect(
      plannedCanvasOrder({
        dragId: 'c3',
        target: { id: 'c1', kind: 'canvas', edge: 'before' },
        canvases,
        folders: [],
      }),
    ).toEqual({ folderId: null, ids: ['c3', 'c1', 'c2'] });
  });

  it('plans moving a canvas after a later sibling', () => {
    const canvases = [
      canvas({ id: 'c1', name: 'A', sortOrder: 0 }),
      canvas({ id: 'c2', name: 'B', sortOrder: 1 }),
      canvas({ id: 'c3', name: 'C', sortOrder: 2 }),
    ];
    expect(
      plannedCanvasOrder({
        dragId: 'c1',
        target: { id: 'c3', kind: 'canvas', edge: 'after' },
        canvases,
        folders: [],
      }),
    ).toEqual({ folderId: null, ids: ['c2', 'c3', 'c1'] });
  });

  it('plans folder reorder and persists canvas drop', async () => {
    const folders: CanvasFolder[] = [
      { id: 'f1', name: 'A', createdAt: 1, sortOrder: 0 },
      { id: 'f2', name: 'B', createdAt: 2, sortOrder: 1 },
    ];
    expect(
      plannedFolderOrder({
        dragId: 'f2',
        target: { id: 'f1', kind: 'folder', edge: 'before' },
        folders,
      }),
    ).toEqual(['f2', 'f1']);

    await db.canvasFolders.bulkAdd(folders);
    await applyCanvasFolderOrder(['f2', 'f1']);
    expect((await db.canvasFolders.get('f1'))?.sortOrder).toBe(1);
    expect((await db.canvasFolders.get('f2'))?.sortOrder).toBe(0);

    await db.canvases.bulkAdd([
      canvas({ id: 'c1', name: 'A', sortOrder: 0 }),
      canvas({ id: 'c2', name: 'B', sortOrder: 1 }),
    ]);
    await persistCanvasHistoryDrop({
      dragId: 'c2',
      dragKind: 'canvas',
      target: { id: 'f1', kind: 'folder', edge: 'into' },
      canvases: await db.canvases.toArray(),
      folders: await db.canvasFolders.toArray(),
    });
    expect((await db.canvases.get('c2'))?.folderId).toBe('f1');
    expect(
      canvasesInFolder(await db.canvases.toArray(), 'f1', await db.canvasFolders.toArray()).map(
        (c) => c.id,
      ),
    ).toEqual(['c2']);
  });

  it('hit-tests folder as into for a canvas, and before/after for a folder', () => {
    const rects = [
      { id: 'f1', kind: 'folder' as const, top: 0, bottom: 20 },
      { id: 'c1', kind: 'canvas' as const, top: 20, bottom: 40 },
      { id: 'unfiled', kind: 'unfiled' as const, top: 40, bottom: 50 },
    ];
    expect(hitTestHistoryDrop(10, rects, { id: 'c2', kind: 'canvas' })).toEqual({
      id: 'f1',
      kind: 'folder',
      edge: 'into',
    });
    expect(hitTestHistoryDrop(8, rects, { id: 'f2', kind: 'folder' })).toEqual({
      id: 'f1',
      kind: 'folder',
      edge: 'before',
    });
    expect(hitTestHistoryDrop(30, rects, { id: 'c2', kind: 'canvas' })).toEqual({
      id: 'c1',
      kind: 'canvas',
      edge: 'after',
    });
    expect(hitTestHistoryDrop(45, rects, { id: 'c1', kind: 'canvas' })).toEqual({
      id: 'unfiled',
      kind: 'unfiled',
      edge: 'into',
    });
  });

  it('lists canvases whose folder is missing as unfiled', () => {
    const folders: CanvasFolder[] = [{ id: 'f1', name: 'F', createdAt: 1, sortOrder: 0 }];
    const canvases = [
      canvas({ id: 'in', name: 'In', folderId: 'f1' }),
      canvas({ id: 'orphan', name: 'Orphan', folderId: 'gone' }),
      canvas({ id: 'plain', name: 'Plain' }),
    ];
    expect(canvasesInFolder(canvases, null, folders).map((c) => c.id)).toEqual(['orphan', 'plain']);
    expect(canvasesInFolder(canvases, 'f1', folders).map((c) => c.id)).toEqual(['in']);
  });
});
