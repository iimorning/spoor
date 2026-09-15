import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  createArchiveFolder,
  deleteArchiveFolder,
  filterArchivedCardsByFolder,
  moveArchivedCard,
  normalizeArchiveFolderName,
  renameArchiveFolder,
} from '../../src/utils/archiveFolders';

describe('archiveFolders', () => {
  beforeEach(async () => {
    await db.archiveFolders.clear();
    await db.archivedCards.clear();
  });

  it('normalizes folder names', () => {
    expect(normalizeArchiveFolderName('  Quotes  book  ')).toBe('Quotes book');
    expect(normalizeArchiveFolderName('   ')).toBe('');
  });

  it('creates, renames, and deletes a folder, unfiling its cards', async () => {
    const folder = await createArchiveFolder('  Quotes  ');
    expect(folder.name).toBe('Quotes');
    expect(await db.archiveFolders.count()).toBe(1);

    await renameArchiveFolder(folder.id, 'Reading');
    expect((await db.archiveFolders.get(folder.id))?.name).toBe('Reading');

    await db.archivedCards.add({
      id: 'a1',
      archivedAt: 1,
      folderId: folder.id,
      node: { id: 'n1', type: 'note', content: 'x', x: 0, y: 0 },
    });
    await deleteArchiveFolder(folder.id);
    expect(await db.archiveFolders.count()).toBe(0);
    expect((await db.archivedCards.get('a1'))?.folderId).toBeUndefined();
  });

  it('moves a card between folders and unfiled', async () => {
    const folder = await createArchiveFolder('A');
    await db.archivedCards.add({
      id: 'a1',
      archivedAt: 1,
      node: { id: 'n1', type: 'note', content: 'x', x: 0, y: 0 },
    });
    await moveArchivedCard('a1', folder.id);
    expect((await db.archivedCards.get('a1'))?.folderId).toBe(folder.id);
    await moveArchivedCard('a1', null);
    expect((await db.archivedCards.get('a1'))?.folderId).toBeUndefined();
  });

  it('filters cards by folder', () => {
    const rows = [
      { id: 'a', folderId: 'f1' },
      { id: 'b' },
      { id: 'c', folderId: 'f2' },
    ];
    expect(filterArchivedCardsByFolder(rows, 'all').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(filterArchivedCardsByFolder(rows, 'unfiled').map((r) => r.id)).toEqual(['b']);
    expect(filterArchivedCardsByFolder(rows, 'f1').map((r) => r.id)).toEqual(['a']);
    expect(filterArchivedCardsByFolder(rows, 'pocket')).toEqual([]);
  });
});
