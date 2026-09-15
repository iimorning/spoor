/**
 * Neighborhood helpers for CanvasGraphView insight (archive knowledge graph).
 */
import type { CanvasNode, Edge } from '../db';
import { getCanvasNodeSearchText } from './canvasNodeSearch';

export type GraphNeighborHop = {
  id: string;
  hops: number;
};

/** Undirected BFS from hub, capped by hop depth and member count. */
export function collectGraphNeighborhood(
  hubId: string,
  edges: Pick<Edge, 'id' | 'from' | 'to' | 'note'>[],
  opts?: { maxHops?: number; maxMembers?: number },
): {
  memberIds: string[];
  edgeIds: string[];
  edgeNotes: string[];
} {
  const maxHops = opts?.maxHops ?? 1;
  const maxMembers = opts?.maxMembers ?? 12;

  const adj = new Map<string, { other: string; edgeId: string; note?: string }[]>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push({ other: e.to, edgeId: e.id, note: e.note });
    adj.get(e.to)!.push({ other: e.from, edgeId: e.id, note: e.note });
  }

  const memberIds: string[] = [hubId];
  const memberSet = new Set<string>([hubId]);
  const edgeIds: string[] = [];
  const edgeIdSet = new Set<string>();
  const edgeNotes: string[] = [];

  let frontier = [hubId];
  for (let hop = 1; hop <= maxHops && memberIds.length < maxMembers; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const link of adj.get(id) ?? []) {
        if (!edgeIdSet.has(link.edgeId)) {
          edgeIdSet.add(link.edgeId);
          edgeIds.push(link.edgeId);
          const note = (link.note ?? '').trim();
          if (note) edgeNotes.push(note);
        }
        if (memberSet.has(link.other)) continue;
        if (memberIds.length >= maxMembers) break;
        memberSet.add(link.other);
        memberIds.push(link.other);
        next.push(link.other);
      }
    }
    frontier = next;
  }

  return { memberIds, edgeIds, edgeNotes };
}

export type GraphInsightCard = {
  id: string;
  type: string;
  title: string;
  excerpt: string;
  isHub: boolean;
};

export function buildGraphInsightCards(
  memberIds: string[],
  hubId: string,
  nodesById: Map<string, CanvasNode>,
  maxCharsPerCard = 280,
): GraphInsightCard[] {
  const cards: GraphInsightCard[] = [];
  for (const id of memberIds) {
    const node = nodesById.get(id);
    if (!node) continue;
    if (node.type === 'image' || node.type === 'video') continue;
    const raw = getCanvasNodeSearchText(node).replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const title = raw.length > 48 ? `${raw.slice(0, 48)}…` : raw;
    const excerpt = raw.length > maxCharsPerCard ? `${raw.slice(0, maxCharsPerCard)}…` : raw;
    cards.push({
      id,
      type: node.type,
      title,
      excerpt,
      isHub: id === hubId,
    });
  }
  return cards;
}

export function formatGraphInsightContext(
  cards: GraphInsightCard[],
  edgeNotes: string[],
): string {
  const lines: string[] = [];
  for (const card of cards) {
    const tag = card.isHub ? '[HUB]' : `[${card.type}]`;
    lines.push(`${tag} ${card.excerpt}`);
  }
  if (edgeNotes.length > 0) {
    lines.push('');
    lines.push('Link notes between cards:');
    for (const note of edgeNotes.slice(0, 8)) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join('\n\n');
}
