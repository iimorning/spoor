import { db, type ArchiveFolder } from '../db';

export const LAST_ARCHIVE_FOLDER_STORAGE_KEY = 'spoor_archive_last_folder_id';
export const SELECTED_ARCHIVE_FOLDER_STORAGE_KEY = 'spoor_archive_selected_folder';

export type ArchiveFolderFilter = 'all' | 'unfiled' | 'pocket' | string;

export function normalizeArchiveFolderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export async function createArchiveFolder(name: string): Promise<ArchiveFolder> {
  const trimmed = normalizeArchiveFolderName(name);
  if (!trimmed) throw new Error('Folder name required');

  const folders = await db.archiveFolders.toArray();
  const maxOrder = folders.reduce((m, f) => Math.max(m, f.sortOrder), -1);
  const folder: ArchiveFolder = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: Date.now(),
    sortOrder: maxOrder + 1,
  };
  await db.archiveFolders.add(folder);
  return folder;
}

export async function renameArchiveFolder(id: string, name: string): Promise<void> {
  const trimmed = normalizeArchiveFolderName(name);
  if (!trimmed) throw new Error('Folder name required');
  const existing = await db.archiveFolders.get(id);
  if (!existing) throw new Error('Folder not found');
  await db.archiveFolders.update(id, { name: trimmed });
}

export async function deleteArchiveFolder(id: string): Promise<void> {
  await db.transaction('rw', db.archiveFolders, db.archivedCards, async () => {
    const cards = await db.archivedCards.where('folderId').equals(id).toArray();
    for (const card of cards) {
      const next = { ...card };
      delete next.folderId;
      await db.archivedCards.put(next);
    }
    await db.archiveFolders.delete(id);
  });
}

export async function moveArchivedCard(archiveId: string, folderId: string | null): Promise<void> {
  const entry = await db.archivedCards.get(archiveId);
  if (!entry) throw new Error('Archive entry not found');
  if (folderId) {
    const folder = await db.archiveFolders.get(folderId);
    if (!folder) throw new Error('Folder not found');
    await db.archivedCards.update(archiveId, { folderId });
    return;
  }
  const next = { ...entry };
  delete next.folderId;
  await db.archivedCards.put(next);
}

/** `undefined` = no preference; `null` = unfiled; string = folder id. */
export function readLastArchiveFolderId(): string | null | undefined {
  try {
    const raw = localStorage.getItem(LAST_ARCHIVE_FOLDER_STORAGE_KEY);
    if (raw === null) return undefined;
    if (raw === '') return null;
    return raw;
  } catch {
    return undefined;
  }
}

export function writeLastArchiveFolderId(folderId: string | null): void {
  try {
    localStorage.setItem(LAST_ARCHIVE_FOLDER_STORAGE_KEY, folderId ?? '');
  } catch {
    /* ignore quota / private mode */
  }
}

export function readSelectedArchiveFolderFilter(): ArchiveFolderFilter {
  try {
    const raw = localStorage.getItem(SELECTED_ARCHIVE_FOLDER_STORAGE_KEY);
    if (!raw) return 'all';
    return raw;
  } catch {
    return 'all';
  }
}

export function writeSelectedArchiveFolderFilter(filter: ArchiveFolderFilter): void {
  try {
    localStorage.setItem(SELECTED_ARCHIVE_FOLDER_STORAGE_KEY, filter);
  } catch {
    /* ignore */
  }
}

export function filterArchivedCardsByFolder<T extends { folderId?: string }>(
  rows: T[],
  filter: ArchiveFolderFilter,
): T[] {
  if (filter === 'all') return rows;
  if (filter === 'unfiled') return rows.filter((row) => !row.folderId);
  if (filter === 'pocket') return [];
  return rows.filter((row) => row.folderId === filter);
}
