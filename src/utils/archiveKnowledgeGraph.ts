import type { ArchivedCard, CanvasNode, Edge } from '../db';
import { buildArchiveListItem } from './archiveCards';

const FOLDER_EDGE_NOTE = 'same archive folder';

function undirectedKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Snapshot an archived card as a graph node (id = archive entry id). */
export function archivedCardToGraphNode(entry: ArchivedCard): CanvasNode {
  const item = buildArchiveListItem(entry);
  return {
    ...entry.node,
    id: entry.id,
    content: item.body || entry.node.content,
    description: item.title || entry.node.description,
    x: 0,
    y: 0,
  };
}

/**
 * Edges among archived knowledge cards:
 * - reconstructed from live canvas edges whose endpoints match archived source node ids
 * - a time-ordered chain inside each archive folder (so filed knowledge can cluster)
 */
export function buildArchiveKnowledgeEdges(
  rows: ArchivedCard[],
  canvasEdges: Array<Pick<Edge, 'id' | 'from' | 'to' | 'note'>>,
): Edge[] {
  const archivesBySource = new Map<string, string[]>();
  for (const row of rows) {
    const src = row.node.id;
    const list = archivesBySource.get(src) ?? [];
    list.push(row.id);
    archivesBySource.set(src, list);
  }

  const out: Edge[] = [];
  const seen = new Set<string>();

  const add = (from: string, to: string, note?: string) => {
    if (from === to) return;
    const key = undirectedKey(from, to);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: `archive-edge-${key}`,
      from,
      to,
      canvasId: '',
      ...(note ? { note } : {}),
    });
  };

  for (const e of canvasEdges) {
    const fromIds = archivesBySource.get(e.from) ?? [];
    const toIds = archivesBySource.get(e.to) ?? [];
    const note = (e.note ?? '').trim();
    for (const fa of fromIds) {
      for (const ta of toIds) {
        add(fa, ta, note || undefined);
      }
    }
  }

  const byFolder = new Map<string, ArchivedCard[]>();
  for (const row of rows) {
    const folderId = (row.folderId ?? '').trim();
    if (!folderId) continue;
    const list = byFolder.get(folderId) ?? [];
    list.push(row);
    byFolder.set(folderId, list);
  }
  for (const group of byFolder.values()) {
    const sorted = group.slice().sort((a, b) => a.archivedAt - b.archivedAt);
    for (let i = 0; i < sorted.length - 1; i++) {
      add(sorted[i]!.id, sorted[i + 1]!.id, FOLDER_EDGE_NOTE);
    }
  }

  return out;
}

/** Include other cards in the hub's folder so insight can read a filed cluster. */
export function expandInsightWithFolderMates(
  hubId: string,
  memberIds: string[],
  rows: ArchivedCard[],
  maxMembers = 12,
): string[] {
  const hub = rows.find((r) => r.id === hubId);
  const folderId = (hub?.folderId ?? '').trim();
  if (!folderId) return memberIds.slice(0, maxMembers);

  const ordered = [...memberIds];
  const seen = new Set(ordered);
  for (const row of rows) {
    if (ordered.length >= maxMembers) break;
    if ((row.folderId ?? '').trim() !== folderId) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ordered.push(row.id);
  }
  return ordered.slice(0, maxMembers);
}
