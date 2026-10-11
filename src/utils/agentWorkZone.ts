import type { TFunction } from 'i18next';
import { db } from '../db';
import type { CanvasNode, CanvasWorkZone, Edge } from '../db';
import { DEFAULT_NODE_SIZE } from './canvas';
import {
  isAttachableImageContent,
  isImageDataUrl,
  MAX_DATA_URL_CHARS,
} from './canvasContextImages';
import { collectReachableAskIds } from './canvasAskContext';

/** Text + multimodal context bucket shared by work-zone collectors. */
export interface ReachableContextPayload {
  textNodeIds: string[];
  imageNodeIds: string[];
  imageDataUrls: string[];
  edgeNotesBlock: string;
  agentNodeIds: string[];
}
import {
  findInnermostWorkZone,
  findPersonaForNodeInZones,
  isNodeInWorkZone,
  nodeCenter,
} from './workZoneGeometry';

/** @deprecated Halo radius — kept for legacy migration heuristics only. */
export const AGENT_WORK_ZONE_RADIUS_PX = 280;

const TEXT_TYPES = new Set(['note', 'text', 'ai', 'document', 'theme', 'book', 'essay']);
const LOG_PREFIX = '[Spoor WorkZone]';

/** Canvas cards that own a work zone + side-panel chat thread. */
export function isPersonaAnchorNode(node: CanvasNode): boolean {
  return node.type === 'agent' || node.type === 'ask';
}

export function listPersonaAnchorNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter(isPersonaAnchorNode);
}

export function distanceBetweenNodes(a: CanvasNode, b: CanvasNode): number {
  const ac = nodeCenter(a);
  const bc = nodeCenter(b);
  return Math.hypot(ac.x - bc.x, ac.y - bc.y);
}

/** @deprecated Radius halo — use drawn work zones instead. */
export function isNodeInAgentWorkZone(
  node: CanvasNode,
  personaNode: CanvasNode,
  radius = AGENT_WORK_ZONE_RADIUS_PX,
): boolean {
  if (!isPersonaAnchorNode(personaNode)) return false;
  if (node.id === personaNode.id) return false;
  return distanceBetweenNodes(node, personaNode) <= radius;
}

/**
 * Find persona for a node from drawn work zones.
 * @deprecated Use findPersonaForNodeInZones directly.
 */
export function findAgentWorkZoneContaining(
  node: CanvasNode,
  zones: CanvasWorkZone[],
): CanvasNode | undefined {
  const personaId = findPersonaForNodeInZones(node, zones);
  if (!personaId) return undefined;
  return { id: personaId, type: 'agent', x: 0, y: 0 } as CanvasNode;
}

/** Migration only — never call during normal drag. */
export function findNearestAgentForNode(
  node: CanvasNode,
  agents: CanvasNode[],
): CanvasNode | undefined {
  const pool = agents.filter((a) => a.type === 'agent');
  if (pool.length === 0) return undefined;
  let best = pool[0]!;
  let bestDist = distanceBetweenNodes(node, best);
  for (let i = 1; i < pool.length; i++) {
    const d = distanceBetweenNodes(node, pool[i]!);
    if (d < bestDist) {
      best = pool[i]!;
      bestDist = d;
    }
  }
  return best;
}

export function collectWorkZoneNodeIds(agentNodeId: string, nodes: CanvasNode[]): string[] {
  return nodes
    .filter((n) => n.id !== agentNodeId && n.contextScopeAgentId === agentNodeId)
    .map((n) => n.id)
    .sort();
}

/** Marquee/selection focus only counts cards already in this persona's work zone. */
export function filterSelectionToWorkZoneFocus(
  agentNodeId: string,
  nodes: CanvasNode[],
  selectedIds: string[],
  zones?: CanvasWorkZone[],
): string[] {
  const scope = new Set(collectWorkZoneNodeIds(agentNodeId, nodes));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return selectedIds.filter((id) => {
    if (scope.has(id)) return true;
    if (!zones?.length) return false;
    const node = byId.get(id);
    if (!node || isPersonaAnchorNode(node)) return false;
    return findPersonaForNodeInZones(node, zones) === agentNodeId;
  });
}

/**
 * Resolve cards shown in the side-panel composer. Work-zone membership is the
 * normal rule; if stale/unbound room metadata yields no match, preserve the
 * user's explicit selection instead of silently dropping every chip.
 */
export function resolveComposerFocusNodeIds(
  agentNodeId: string,
  nodes: CanvasNode[],
  selectedIds: string[],
  zones?: CanvasWorkZone[],
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selectable = selectedIds.filter((id) => {
    const node = byId.get(id);
    return Boolean(node && !isPersonaAnchorNode(node));
  });
  const inScope = filterSelectionToWorkZoneFocus(agentNodeId, nodes, selectable, zones);
  return inScope.length > 0 || selectable.length === 0 ? inScope : selectable;
}

function bucketNodeIds(
  scanIds: string[],
  byId: Map<string, CanvasNode>,
): Pick<ReachableContextPayload, 'textNodeIds' | 'imageNodeIds' | 'imageDataUrls' | 'agentNodeIds'> {
  const imageIds = new Set<string>();
  const textIds = new Set<string>();
  const agentIds = new Set<string>();

  for (const id of scanIds) {
    const n = byId.get(id);
    if (!n) continue;
    if (n.type === 'image') {
      const c = (n.content ?? '').trim();
      if (!isAttachableImageContent(c)) continue;
      if (isImageDataUrl(c) && c.length > MAX_DATA_URL_CHARS) {
        console.warn(`${LOG_PREFIX} skip oversized image node ${id} (${c.length} chars)`);
        continue;
      }
      imageIds.add(id);
    } else if (n.type === 'agent') {
      agentIds.add(id);
    } else if (TEXT_TYPES.has(n.type)) {
      textIds.add(id);
    }
  }

  const imageNodeIds = [...imageIds].sort();
  const imageDataUrls = imageNodeIds.map((id) => (byId.get(id)!.content ?? '').trim());

  return {
    textNodeIds: [...textIds].sort(),
    imageNodeIds,
    imageDataUrls,
    agentNodeIds: [...agentIds].sort(),
  };
}

export function collectWorkZoneContextPayload(
  agentNodeId: string,
  nodes: CanvasNode[],
  focusNodeIds?: string[],
): WorkZoneContextPayload {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const scopeIds = collectWorkZoneNodeIds(agentNodeId, nodes);
  const focusSet = new Set(focusNodeIds ?? []);
  const focusInScope = scopeIds.filter((id) => focusSet.has(id));
  const backgroundIds = scopeIds.filter((id) => !focusSet.has(id));

  const focusBucket = bucketNodeIds(focusInScope, byId);
  const bgBucket = bucketNodeIds(backgroundIds, byId);

  return {
    textNodeIds: [...focusBucket.textNodeIds, ...bgBucket.textNodeIds],
    imageNodeIds: [...focusBucket.imageNodeIds, ...bgBucket.imageNodeIds],
    imageDataUrls: [...focusBucket.imageDataUrls, ...bgBucket.imageDataUrls],
    edgeNotesBlock: '',
    agentNodeIds: focusBucket.agentNodeIds.length
      ? focusBucket.agentNodeIds
      : bgBucket.agentNodeIds,
    focusTextNodeIds: focusBucket.textNodeIds,
    focusImageNodeIds: focusBucket.imageNodeIds,
    backgroundTextNodeIds: bgBucket.textNodeIds,
    backgroundImageNodeIds: bgBucket.imageNodeIds,
  };
}

export interface WorkZoneContextPayload extends ReachableContextPayload {
  focusTextNodeIds?: string[];
  focusImageNodeIds?: string[];
  backgroundTextNodeIds?: string[];
  backgroundImageNodeIds?: string[];
}

export function buildWorkZoneContextText(
  payload: WorkZoneContextPayload,
  t: TFunction,
  readBody: (id: string) => string,
): string {
  const fragmentLabel = t('ai.prompts.context_fragment_label');
  const focusHeading = t('canvas.v2.focus_context_heading', { defaultValue: '【本轮重点】' });
  const workspaceHeading = t('canvas.v2.workspace_context_heading', {
    defaultValue: '【工作区背景】',
  });

  let contextText = '';

  const appendIds = (ids: string[], heading?: string) => {
    if (ids.length === 0) return;
    if (heading) contextText += heading + '\n';
    for (const id of ids) {
      const body = readBody(id);
      if (body) contextText += fragmentLabel + body;
    }
  };

  const focusText = payload.focusTextNodeIds ?? [];
  const bgText = payload.backgroundTextNodeIds ?? [];

  if (focusText.length > 0) {
    appendIds(focusText, focusHeading);
    if (bgText.length > 0) {
      contextText += '\n';
      appendIds(bgText, workspaceHeading);
    }
  } else {
    appendIds(payload.textNodeIds);
  }

  return contextText.trim();
}

/** System-only workspace background: unselected text materials; whole zone when no focus. */
export function buildWorkZoneBackgroundText(
  payload: WorkZoneContextPayload,
  t: TFunction,
  readBody: (id: string) => string,
): string {
  const fragmentLabel = t('ai.prompts.context_fragment_label');
  const workspaceHeading = t('canvas.v2.workspace_context_heading', {
    defaultValue: '【工作区背景】',
  });

  const focusText = payload.focusTextNodeIds ?? [];
  const bgText = payload.backgroundTextNodeIds ?? [];
  const ids = focusText.length > 0 ? bgText : payload.textNodeIds;

  if (ids.length === 0) return '';

  let contextText = '';
  if (focusText.length > 0 && bgText.length > 0) {
    contextText += workspaceHeading + '\n';
  }
  for (const id of ids) {
    const body = readBody(id);
    if (body) contextText += fragmentLabel + body;
  }
  return contextText.trim();
}

/** One-time migration: BFS from each agent's edge component → assign scope. */
export function inferWorkZoneAssignments(
  nodes: CanvasNode[],
  edges: Edge[],
): Map<string, string> {
  const agents = nodes.filter((n) => n.type === 'agent');
  const assignments = new Map<string, string>();
  if (agents.length === 0) return assignments;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const agent of agents) {
    const reachable = collectReachableAskIds(agent.id, edges);
    for (const id of reachable) {
      const n = byId.get(id);
      if (!n || n.type === 'agent') continue;
      if (assignments.has(id)) continue;
      assignments.set(id, agent.id);
    }
  }

  for (const node of nodes) {
    if (node.type === 'agent' || assignments.has(node.id)) continue;
    const nearest = findNearestAgentForNode(node, agents);
    if (nearest) assignments.set(node.id, nearest.id);
  }

  return assignments;
}

export function personaThreadId(canvasId: string, agentNodeId: string): string {
  return `${canvasId}:${agentNodeId}`;
}

export type WorkZoneDragEndResult = {
  assigned?: string;
  cleared?: boolean;
  boundZoneId?: string;
  blocked?: boolean;
};

/** First persona whose center is already inside an unbound zone (stable: createdAt, then id). */
export function pickPersonaToClaimUnboundZone(
  nodes: CanvasNode[],
  zone: CanvasWorkZone,
): CanvasNode | undefined {
  if (zone.personaNodeId) {
    const owner = nodes.find((n) => n.id === zone.personaNodeId && isPersonaAnchorNode(n));
    if (owner) return undefined;
  }
  const occupants = nodes.filter((n) => isPersonaAnchorNode(n) && isNodeInWorkZone(n, zone));
  occupants.sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id),
  );
  return occupants[0];
}

/**
 * 允许停在别人房间里的例外：这个人是否在那间房的讨论名单里。
 * 房间归属不变 —— 名单里的人只是客人，房间仍然属于主角色。
 */
export type RoomGuestCheck = (zoneHostNodeId: string, personaNodeId: string) => boolean;

/** True when this persona would land in a room already bound to someone else. */
export function personaBlockedByForeignWorkZone(
  node: CanvasNode,
  pos: { x: number; y: number },
  zones: CanvasWorkZone[],
  liveNodes?: CanvasNode[],
  isRoomGuest?: RoomGuestCheck,
): boolean {
  if (!isPersonaAnchorNode(node)) return false;
  const zone = findInnermostWorkZone({ ...node, ...pos }, zones);
  if (!zone?.personaNodeId || zone.personaNodeId === node.id) return false;
  if (liveNodes && !liveNodes.some((n) => n.id === zone.personaNodeId && isPersonaAnchorNode(n))) {
    return false;
  }
  // 已经在里面的不再拦：名单被移出之后，卡在里面也要能动。
  if (isNodeInWorkZone(node, zone)) return false;
  if (isRoomGuest?.(zone.personaNodeId, node.id)) return false;
  return true;
}

function zoneOwnerIsMissing(zone: CanvasWorkZone, nodes: CanvasNode[]): boolean {
  if (!zone.personaNodeId) return true;
  return !nodes.some((n) => n.id === zone.personaNodeId && isPersonaAnchorNode(n));
}

/**
 * Unbind rooms, drop side-panel threads, and clear card scopes for deleted
 * Ask / agent cards so another persona can claim the empty room.
 */
export async function releasePersonaBindings(
  personaNodeIds: Iterable<string>,
): Promise<{ unboundZoneIds: string[]; deletedThreadIds: string[]; clearedScopeNodeIds: string[] }> {
  const ids = [...new Set([...personaNodeIds].filter(Boolean))];
  const empty = { unboundZoneIds: [] as string[], deletedThreadIds: [] as string[], clearedScopeNodeIds: [] as string[] };
  if (ids.length === 0) return empty;

  const [zones, threads, scopedNodes] = await Promise.all([
    db.canvasWorkZones.where('personaNodeId').anyOf(ids).toArray(),
    db.canvasPersonaThreads.where('agentNodeId').anyOf(ids).toArray(),
    db.nodes
      .filter((n) => Boolean(n.contextScopeAgentId && ids.includes(n.contextScopeAgentId)))
      .toArray(),
  ]);
  const idSet = new Set(ids);
  const scopedKeep = scopedNodes.filter((n) => !idSet.has(n.id));

  await db.transaction('rw', db.canvasWorkZones, db.canvasPersonaThreads, db.nodes, async () => {
    for (const zone of zones) {
      await db.canvasWorkZones.update(zone.id, { personaNodeId: undefined });
    }
    if (threads.length > 0) await db.canvasPersonaThreads.bulkDelete(threads.map((t) => t.id));
    for (const node of scopedKeep) {
      await db.nodes.update(node.id, { contextScopeAgentId: undefined });
    }
  });

  const result = {
    unboundZoneIds: zones.map((z) => z.id),
    deletedThreadIds: threads.map((t) => t.id),
    clearedScopeNodeIds: scopedKeep.map((n) => n.id),
  };
  return result;
}

/**
 * Runtime drag-end: notes get scope from bound zones; the first persona into
 * an empty zone claims it; other personas cannot enter a claimed zone.
 */
export async function applyWorkZoneOnDragEnd(
  draggedNodeId: string,
  finalPos: { x: number; y: number },
  nodes: CanvasNode[],
  zones: CanvasWorkZone[],
  isRoomGuest?: RoomGuestCheck,
): Promise<WorkZoneDragEndResult> {
  const dragged = nodes.find((n) => n.id === draggedNodeId);
  if (!dragged) return {};

  const placed: CanvasNode = { ...dragged, x: finalPos.x, y: finalPos.y };

  if (isPersonaAnchorNode(dragged)) {
    const zone = findInnermostWorkZone(placed, zones);
    if (!zone) return {};
    if (zoneOwnerIsMissing(zone, nodes)) {
      await db.canvasWorkZones.update(zone.id, { personaNodeId: dragged.id });
      return { boundZoneId: zone.id, assigned: dragged.id };
    }
    if (zone.personaNodeId !== dragged.id) {
      // 名单里的人可以停进主角色的房间；已经在里面的也不再赶。
      if (isRoomGuest?.(zone.personaNodeId, dragged.id)) return {};
      if (isNodeInWorkZone(dragged, zone)) return {};
      return { blocked: true };
    }
    return {};
  }

  const personaId = findPersonaForNodeInZones(placed, zones);

  if (personaId) {
    if (dragged.contextScopeAgentId !== personaId) {
      await db.nodes.update(draggedNodeId, { contextScopeAgentId: personaId });
      return { assigned: personaId };
    }
    return {};
  }

  const stillScoped = dragged.contextScopeAgentId
    && zones.some(
      (zone) =>
        zone.personaNodeId === dragged.contextScopeAgentId
        && isNodeInWorkZone(placed, zone),
    );

  if (dragged.contextScopeAgentId && !stillScoped) {
    await db.nodes.update(draggedNodeId, { contextScopeAgentId: undefined });
    return { cleared: true };
  }
  return {};
}

export function resolveWorkZonePersonaId(
  nodes: CanvasNode[],
  preferredPersonaNodeId: string | null | undefined,
): string | undefined {
  if (preferredPersonaNodeId) {
    const preferred = nodes.find((n) => n.id === preferredPersonaNodeId);
    if (preferred && isPersonaAnchorNode(preferred)) return preferredPersonaNodeId;
  }
  return listPersonaAnchorNodes(nodes)[0]?.id;
}

export function defaultExcerptNoteSize(): { width: number; height: number } {
  return { width: DEFAULT_NODE_SIZE.width, height: Math.round(DEFAULT_NODE_SIZE.height * 0.75) };
}

