import { db, type Canvas, type CanvasFolder } from '../db';

export const CANVAS_HISTORY_LONG_PRESS_MS = 380;

export function normalizeCanvasFolderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function sortCanvasFolders(folders: CanvasFolder[]): CanvasFolder[] {
  return [...folders].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt - b.createdAt;
  });
}

export function sortCanvasesForHistory(canvases: Canvas[]): Canvas[] {
  const anyOrder = canvases.some((c) => typeof c.sortOrder === 'number');
  if (!anyOrder) return [...canvases];
  return [...canvases].sort((a, b) => {
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

export function canvasesInFolder(
  canvases: Canvas[],
  folderId: string | null,
  folders: CanvasFolder[] = [],
): Canvas[] {
  const known = new Set(folders.map((f) => f.id));
  return sortCanvasesForHistory(
    canvases.filter((c) => {
      const id = c.folderId ?? null;
      if (folderId === null) return !id || !known.has(id);
      return id === folderId;
    }),
  );
}

export async function nextCanvasSortOrder(): Promise<number> {
  const canvases = await db.canvases.toArray();
  let max = canvases.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1);
  const missing = canvases.filter((c) => typeof c.sortOrder !== 'number');
  if (missing.length > 0) {
    await db.transaction('rw', db.canvases, async () => {
      for (const canvas of missing) {
        max += 1;
        await db.canvases.update(canvas.id, { sortOrder: max });
      }
    });
  }
  return max + 1;
}

export async function createCanvasFolder(name: string): Promise<CanvasFolder> {
  const trimmed = normalizeCanvasFolderName(name);
  if (!trimmed) throw new Error('Folder name required');
  const folders = await db.canvasFolders.toArray();
  const maxOrder = folders.reduce((m, f) => Math.max(m, f.sortOrder), -1);
  const folder: CanvasFolder = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: Date.now(),
    sortOrder: maxOrder + 1,
  };
  await db.canvasFolders.add(folder);
  return folder;
}

export async function renameCanvasFolder(id: string, name: string): Promise<void> {
  const trimmed = normalizeCanvasFolderName(name);
  if (!trimmed) throw new Error('Folder name required');
  const existing = await db.canvasFolders.get(id);
  if (!existing) throw new Error('Folder not found');
  await db.canvasFolders.update(id, { name: trimmed });
}

export async function deleteCanvasFolder(id: string): Promise<void> {
  await db.transaction('rw', db.canvasFolders, db.canvases, async () => {
    const members = await db.canvases.where('folderId').equals(id).toArray();
    for (const canvas of members) {
      const next = { ...canvas };
      delete next.folderId;
      await db.canvases.put(next);
    }
    await db.canvasFolders.delete(id);
  });
}

async function writeSiblingOrder(ids: string[], folderId: string | null): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.canvases, async () => {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const row = await db.canvases.get(id);
      if (!row) continue;
      const next: Canvas = { ...row, sortOrder: i, updatedAt: now };
      if (folderId) next.folderId = folderId;
      else delete next.folderId;
      await db.canvases.put(next);
    }
  });
}

export async function applyCanvasFolderOrder(ids: string[]): Promise<void> {
  await db.transaction('rw', db.canvasFolders, async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.canvasFolders.update(ids[i]!, { sortOrder: i });
    }
  });
}

export type HistoryDragKind = 'canvas' | 'folder';

export type HistoryDropTarget = {
  id: string;
  kind: HistoryDragKind | 'unfiled';
  edge: 'before' | 'after' | 'into';
};

function moveId(ids: string[], id: string, toIndex: number): string[] {
  const next = ids.filter((x) => x !== id);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, id);
  return next;
}

export function plannedCanvasOrder(args: {
  dragId: string;
  target: HistoryDropTarget;
  canvases: Canvas[];
  folders: CanvasFolder[];
}): { folderId: string | null; ids: string[] } | null {
  const { dragId, target, canvases } = args;
  const drag = canvases.find((c) => c.id === dragId);
  if (!drag) return null;

  if (target.kind === 'unfiled' || (target.kind === 'folder' && target.edge === 'into')) {
    const folderId = target.kind === 'unfiled' ? null : target.id;
    const siblings = canvasesInFolder(canvases, folderId, args.folders)
      .map((c) => c.id)
      .filter((id) => id !== dragId);
    return { folderId, ids: [...siblings, dragId] };
  }

  if (target.kind !== 'canvas') return null;
  const dest = canvases.find((c) => c.id === target.id);
  if (!dest || dest.id === dragId) return null;
  const folderId = dest.folderId ?? null;
  const siblings = canvasesInFolder(canvases, folderId, args.folders).map((c) => c.id);
  const destIndex = siblings.indexOf(dest.id);
  if (destIndex < 0) return null;
  const insertAt = target.edge === 'after' ? destIndex + 1 : destIndex;
  const without = siblings.filter((id) => id !== dragId);
  const adjusted = siblings.includes(dragId) && siblings.indexOf(dragId) < destIndex
    ? insertAt - 1
    : insertAt;
  return { folderId, ids: moveId([...without], dragId, Math.max(0, adjusted)) };
}

export function plannedFolderOrder(args: {
  dragId: string;
  target: HistoryDropTarget;
  folders: CanvasFolder[];
}): string[] | null {
  const { dragId, target, folders } = args;
  if (!folders.some((f) => f.id === dragId)) return null;
  if (target.kind !== 'folder' || target.edge === 'into') return null;
  const ids = sortCanvasFolders(folders).map((f) => f.id);
  const destIndex = ids.indexOf(target.id);
  if (destIndex < 0 || target.id === dragId) return null;
  const insertAt = target.edge === 'after' ? destIndex + 1 : destIndex;
  const without = ids.filter((id) => id !== dragId);
  const adjusted = ids.indexOf(dragId) < destIndex ? insertAt - 1 : insertAt;
  return moveId(without, dragId, Math.max(0, adjusted));
}

export async function persistCanvasHistoryDrop(args: {
  dragId: string;
  dragKind: HistoryDragKind;
  target: HistoryDropTarget;
  canvases: Canvas[];
  folders: CanvasFolder[];
}): Promise<void> {
  if (args.dragKind === 'folder') {
    const ids = plannedFolderOrder({
      dragId: args.dragId,
      target: args.target,
      folders: args.folders,
    });
    if (ids) await applyCanvasFolderOrder(ids);
    return;
  }
  const plan = plannedCanvasOrder({
    dragId: args.dragId,
    target: args.target,
    canvases: args.canvases,
    folders: args.folders,
  });
  if (plan) await writeSiblingOrder(plan.ids, plan.folderId);
}

export type HistoryDropRect = {
  id: string;
  kind: HistoryDragKind | 'unfiled';
  top: number;
  bottom: number;
};

export function hitTestHistoryDrop(
  clientY: number,
  rects: HistoryDropRect[],
  drag: { id: string; kind: HistoryDragKind },
): HistoryDropTarget | null {
  if (rects.length === 0) return null;
  for (const rect of rects) {
    if (clientY < rect.top || clientY > rect.bottom) continue;
    if (rect.kind === 'unfiled') {
      if (drag.kind !== 'canvas') return null;
      return { id: 'unfiled', kind: 'unfiled', edge: 'into' };
    }
    if (rect.id === drag.id) return null;
    const mid = (rect.top + rect.bottom) / 2;
    if (drag.kind === 'folder') {
      if (rect.kind !== 'folder') return null;
      return { id: rect.id, kind: 'folder', edge: clientY < mid ? 'before' : 'after' };
    }
    if (rect.kind === 'folder') {
      return { id: rect.id, kind: 'folder', edge: 'into' };
    }
    return {
      id: rect.id,
      kind: 'canvas',
      edge: clientY < mid ? 'before' : 'after',
    };
  }
  return null;
}
