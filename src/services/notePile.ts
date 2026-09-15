import { db, type CanvasNode } from '../db';
import {
  estimateNodeRect,
  rectOverlapRatio,
  type CanvasRect,
} from '../utils/canvas';

/** Photo-pile offset so later (top) cards peek over the ones underneath. */
export const NOTE_PILE_STACK_STEP = 5;

/** Dropped card must cover this fraction of the smaller card to snap. */
export const NOTE_PILE_SNAP_RATIO = 0.28;

/** Still overlapping a sibling this much counts as “staying in the pile”. */
const NOTE_PILE_STAY_RATIO = 0.12;

export function isNotePileEligible(node: CanvasNode): boolean {
  if (node.type !== 'note' && node.type !== 'text') return false;
  if (node.webSearchParentId) return false;
  if (node.bookExpandParentId) return false;
  if (node.essaySourceParentId) return false;
  return true;
}

export function uniqueNotePileIds(ids: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = (raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function resolveNotePileHubId(node: CanvasNode): string | undefined {
  if (node.notePileParentId) return node.notePileParentId;
  if (node.notePileMemberIds && node.notePileMemberIds.length >= 2) return node.id;
  return undefined;
}

export function listNotePileMembers(hub: CanvasNode, nodes: CanvasNode[]): CanvasNode[] {
  const canvasId = hub.canvasId ?? 'default';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ordered = hub.notePileMemberIds ?? [];
  const listed: CanvasNode[] = [];
  for (const id of ordered) {
    const node = byId.get(id);
    if (!node) continue;
    if ((node.canvasId ?? 'default') !== canvasId) continue;
    listed.push(node);
  }
  return listed;
}

export function notePileOrigin(hub: CanvasNode): { x: number; y: number } {
  return {
    x: typeof hub.notePileOriginX === 'number' ? hub.notePileOriginX : hub.x,
    y: typeof hub.notePileOriginY === 'number' ? hub.notePileOriginY : hub.y,
  };
}

/** Visual index 0 = top of the pile = last id in writing order. */
export function notePileVisualIndex(writingIndex: number, length: number): number {
  return Math.max(0, length - 1 - writingIndex);
}

export function notePileStackZIndex(visualIndex: number): number {
  return 420 - visualIndex;
}

export function notePileStackPos(
  origin: { x: number; y: number },
  visualIndex: number,
): { x: number; y: number } {
  return {
    x: origin.x + visualIndex * NOTE_PILE_STACK_STEP,
    y: origin.y + visualIndex * NOTE_PILE_STACK_STEP,
  };
}

export function notePileWritingIndex(hub: CanvasNode, memberId: string): number {
  const i = (hub.notePileMemberIds ?? []).indexOf(memberId);
  return i >= 0 ? i : 0;
}

export function collapsedNotePilePeerIds(nodeId: string, nodes: CanvasNode[]): string[] {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const hubId = resolveNotePileHubId(node);
  if (!hubId) return [];
  const hub = nodes.find((n) => n.id === hubId);
  if (!hub?.notePileCollapsed) return [];
  const members = listNotePileMembers(hub, nodes);
  if (members.length < 2) return [];
  return members.map((m) => m.id);
}

/**
 * When a selection includes any card from a pile, replace it with the full
 * pile in writing order (bottom → top = first → last in the article).
 */
export function expandSelectionWithNotePiles(selectedIds: string[], nodes: CanvasNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>();
  const consumedHubs = new Set<string>();

  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
      continue;
    }
    const hubId = resolveNotePileHubId(node);
    const hub = hubId ? byId.get(hubId) : undefined;
    const members = hub ? listNotePileMembers(hub, nodes) : [];
    if (hub && members.length >= 2) {
      if (consumedHubs.has(hub.id)) continue;
      consumedHubs.add(hub.id);
      for (const member of members) {
        if (seen.has(member.id)) continue;
        seen.add(member.id);
        out.push(member.id);
      }
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function pickNotePileSnapTarget(
  draggedId: string,
  draggedRect: CanvasRect,
  nodes: CanvasNode[],
  excludeIds: Set<string>,
): CanvasNode | null {
  let best: CanvasNode | null = null;
  let bestRatio = NOTE_PILE_SNAP_RATIO;
  for (const other of nodes) {
    if (other.id === draggedId || excludeIds.has(other.id)) continue;
    if (!isNotePileEligible(other)) continue;
    const ratio = rectOverlapRatio(draggedRect, estimateNodeRect(other));
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = other;
    }
  }
  return best;
}

function memberIdsOrSelf(hub: CanvasNode, fallbackId: string): string[] {
  const listed = uniqueNotePileIds(hub.notePileMemberIds ?? []);
  if (listed.length >= 2) return listed;
  return [fallbackId];
}

async function clearNotePileFields(id: string): Promise<void> {
  await db.nodes.where('id').equals(id).modify((node) => {
    delete node.notePileParentId;
    delete node.notePileIndex;
    delete node.notePileMemberIds;
    delete node.notePileCollapsed;
    delete node.notePileOriginX;
    delete node.notePileOriginY;
    delete node.notePileExpandedOffsetX;
    delete node.notePileExpandedOffsetY;
  });
}

async function layoutPile(
  hubId: string,
  memberIds: string[],
  origin: { x: number; y: number },
  collapsed: boolean,
  snapshot: CanvasNode[],
): Promise<void> {
  const ids = uniqueNotePileIds(memberIds);
  const byId = new Map(snapshot.map((n) => [n.id, n]));

  await db.transaction('rw', db.nodes, async () => {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const node = byId.get(id);
      if (!node) continue;
      const visual = notePileVisualIndex(i, ids.length);
      const alreadyStacked =
        collapsed &&
        typeof node.notePileExpandedOffsetX === 'number' &&
        typeof node.notePileExpandedOffsetY === 'number';
      const stackPos = notePileStackPos(origin, visual);
      await db.nodes.where('id').equals(id).modify((row) => {
        if (collapsed) {
          row.x = stackPos.x;
          row.y = stackPos.y;
        }
        row.notePileParentId = hubId;
        row.notePileIndex = i;
        if (collapsed && !alreadyStacked) {
          row.notePileExpandedOffsetX = node.x - origin.x;
          row.notePileExpandedOffsetY = node.y - origin.y;
        }
        if (id === hubId) {
          row.notePileMemberIds = ids;
          row.notePileCollapsed = collapsed;
          row.notePileOriginX = origin.x;
          row.notePileOriginY = origin.y;
        } else {
          delete row.notePileMemberIds;
          delete row.notePileCollapsed;
          delete row.notePileOriginX;
          delete row.notePileOriginY;
        }
      });
    }
  });
}

/**
 * Snap `draggedId` onto `targetId`: target pile stays the hub, dragged card
 * (or its whole pile) is appended — visually on top, last in writing order.
 */
export async function snapNodeOntoNode(
  draggedId: string,
  targetId: string,
  nodes?: CanvasNode[],
): Promise<boolean> {
  const all = nodes ?? (await db.nodes.toArray());
  const dragged = all.find((n) => n.id === draggedId);
  const target = all.find((n) => n.id === targetId);
  if (!dragged || !target) return false;
  if (!isNotePileEligible(dragged) || !isNotePileEligible(target)) return false;
  if (draggedId === targetId) return false;

  const draggedHubId = resolveNotePileHubId(dragged);
  const draggedHub = draggedHubId ? all.find((n) => n.id === draggedHubId) : undefined;
  const movingIds = draggedHub
    ? listNotePileMembers(draggedHub, all).map((m) => m.id)
    : [draggedId];

  const targetHubId = resolveNotePileHubId(target) ?? target.id;
  if (draggedHubId && draggedHubId === targetHubId) return false;

  const targetHub = all.find((n) => n.id === targetHubId) ?? target;
  const targetIds = memberIdsOrSelf(targetHub, target.id);
  const moving = movingIds.filter((id) => !targetIds.includes(id));
  if (moving.length === 0) return false;

  const nextIds = uniqueNotePileIds([...targetIds, ...moving]);
  if (nextIds.length < 2) return false;

  const origin =
    (targetHub.notePileMemberIds?.length ?? 0) >= 2
      ? notePileOrigin(targetHub)
      : { x: target.x, y: target.y };

  await layoutPile(targetHub.id, nextIds, origin, true, all);
  return true;
}

/** If a piled card is dragged far from its siblings, drop it out of the pile. */
export async function maybeLeaveNotePile(
  draggedId: string,
  finalPos: { x: number; y: number },
  nodes?: CanvasNode[],
): Promise<boolean> {
  const all = nodes ?? (await db.nodes.toArray());
  const dragged = all.find((n) => n.id === draggedId);
  if (!dragged || !isNotePileEligible(dragged)) return false;
  const hubId = resolveNotePileHubId(dragged);
  if (!hubId) return false;
  const hub = all.find((n) => n.id === hubId);
  if (!hub) return false;
  const members = listNotePileMembers(hub, all);
  if (members.length < 2) return false;

  const draggedRect = estimateNodeRect({ ...dragged, ...finalPos });
  const stays = members.some((member) => {
    if (member.id === draggedId) return false;
    return rectOverlapRatio(draggedRect, estimateNodeRect(member)) >= NOTE_PILE_STAY_RATIO;
  });
  if (stays) return false;

  const remaining = members.map((m) => m.id).filter((id) => id !== draggedId);
  await clearNotePileFields(draggedId);

  if (remaining.length < 2) {
    for (const id of remaining) {
      await clearNotePileFields(id);
    }
    return true;
  }

  const nextHubId = remaining.includes(hubId) ? hubId : remaining[0]!;
  const origin = notePileOrigin(hub);
  const snapshot = all.map((n) => (n.id === draggedId ? { ...n, ...finalPos } : n));
  await layoutPile(nextHubId, remaining, origin, !!hub.notePileCollapsed, snapshot);
  return true;
}

export async function setNotePileCollapsed(
  hubId: string,
  collapsed: boolean,
  options?: { nodes?: CanvasNode[] },
): Promise<number> {
  const all = options?.nodes ?? (await db.nodes.toArray());
  const hub = all.find((n) => n.id === hubId);
  if (!hub) return 0;
  const members = listNotePileMembers(hub, all);
  if (members.length < 2) return 0;
  const origin = notePileOrigin(hub);
  const ids = members.map((m) => m.id);

  await db.transaction('rw', db.nodes, async () => {
    await db.nodes.update(hubId, { notePileCollapsed: collapsed });
    for (let i = 0; i < members.length; i++) {
      const member = members[i]!;
      if (collapsed) {
        const visual = notePileVisualIndex(i, ids.length);
        const alreadyStacked =
          !!hub.notePileCollapsed &&
          typeof member.notePileExpandedOffsetX === 'number' &&
          typeof member.notePileExpandedOffsetY === 'number';
        await db.nodes.update(member.id, {
          ...notePileStackPos(origin, visual),
          notePileParentId: hubId,
          notePileIndex: i,
          ...(alreadyStacked
            ? {}
            : {
                notePileExpandedOffsetX: member.x - origin.x,
                notePileExpandedOffsetY: member.y - origin.y,
              }),
        });
      } else {
        const dx = member.notePileExpandedOffsetX;
        const dy = member.notePileExpandedOffsetY;
        await db.nodes.update(member.id, {
          x: origin.x + (typeof dx === 'number' ? dx : 0),
          y: origin.y + (typeof dy === 'number' ? dy : (i * 28)),
        });
      }
    }
  });
  return members.length;
}

export async function shiftNotePileOrigin(
  hubId: string,
  delta: { dx: number; dy: number },
): Promise<void> {
  const hub = await db.nodes.get(hubId);
  if (!hub) return;
  const origin = notePileOrigin(hub);
  await db.nodes.update(hubId, {
    notePileOriginX: origin.x + delta.dx,
    notePileOriginY: origin.y + delta.dy,
  });
}
