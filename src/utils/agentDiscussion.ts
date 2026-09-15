import type { CanvasNode, Edge } from '../db';

/** One back-and-forth: two AI cards spawned by Start discussion. */
export const DISCUSSION_TURN_COUNT = 2;

/** Max distinct agent personas in one discussion (hub + neighbors). */
export const DISCUSSION_MAX_SPEAKERS = 3;

/** Reserved speaker id so 阿狸 (Ask card) can sit in a discussion with personas. */
export const ASK_DISCUSSION_SPEAKER_ID = 'spoor.ask';

export function isAskDiscussionSpeaker(id: string): boolean {
  return id === ASK_DISCUSSION_SPEAKER_ID;
}

export function isDiscussionPersonaNodeType(type: string | undefined): boolean {
  return type === 'agent' || type === 'ask';
}

/** Agent↔agent or 阿狸↔agent. Ask↔ask is not a discussion link. */
export function isDiscussionLinkEdge(
  fromType: string | undefined,
  toType: string | undefined,
): boolean {
  if (!isDiscussionPersonaNodeType(fromType) || !isDiscussionPersonaNodeType(toType)) {
    return false;
  }
  return fromType === 'agent' || toType === 'agent';
}

export type AgentDiscussionParticipants = {
  contextNodeId: string;
  /** Ordered AgentConfig ids (2–3). */
  speakerAgentConfigIds: string[];
};

function neighborIdsOf(hubId: string, edges: Edge[]): string[] {
  const ids: string[] = [];
  for (const edge of edges) {
    if (edge.from === hubId) ids.push(edge.to);
    else if (edge.to === hubId) ids.push(edge.from);
  }
  return [...new Set(ids)].sort();
}

/**
 * Resolve discussion cast from a hub agent card's undirected neighbors.
 * Speakers = hub persona + linked agent personas or 阿狸 (sorted ids, max 3).
 * Context = first non-persona neighbor (id-sorted) with non-empty context text.
 */
export function resolveAgentDiscussionParticipants(
  hubAgentNodeId: string,
  nodes: CanvasNode[],
  edges: Edge[],
  getContextText: (nodeId: string) => string,
): AgentDiscussionParticipants | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hub = byId.get(hubAgentNodeId);
  if (!hub || hub.type !== 'agent' || !hub.agentConfigId) return null;

  const neighborIds = neighborIdsOf(hubAgentNodeId, edges);

  let contextNodeId: string | null = null;
  for (const cid of neighborIds) {
    const n = byId.get(cid);
    if (!n || isDiscussionPersonaNodeType(n.type)) continue;
    if (!getContextText(cid).trim()) continue;
    contextNodeId = cid;
    break;
  }
  if (!contextNodeId) return null;

  const speakerSet = new Set<string>([hub.agentConfigId]);
  for (const cid of neighborIds) {
    const n = byId.get(cid);
    if (!n) continue;
    if (n.type === 'ask') {
      speakerSet.add(ASK_DISCUSSION_SPEAKER_ID);
      continue;
    }
    if (n.type !== 'agent' || !n.agentConfigId) continue;
    speakerSet.add(n.agentConfigId);
  }

  const speakerAgentConfigIds = [...speakerSet].sort().slice(0, DISCUSSION_MAX_SPEAKERS);
  if (speakerAgentConfigIds.length < 2) return null;

  return { contextNodeId, speakerAgentConfigIds };
}

export function canStartAgentDiscussion(
  hubAgentNodeId: string,
  nodes: CanvasNode[],
  edges: Edge[],
  getContextText: (nodeId: string) => string,
): boolean {
  return resolveAgentDiscussionParticipants(hubAgentNodeId, nodes, edges, getContextText) != null;
}

/** Next speaker config id after a discussion card (round-robin). */
export function nextDiscussionSpeakerId(
  speakerAgentConfigIds: string[],
  currentTurnIndex: number,
): string | null {
  if (speakerAgentConfigIds.length === 0) return null;
  return speakerAgentConfigIds[(currentTurnIndex + 1) % speakerAgentConfigIds.length] ?? null;
}

/**
 * True when this AI card is the latest reply in a multi-agent discussion
 * (has discussion metadata, finished content, and no later discussion child).
 */
export function isAgentDiscussionLeaf(
  nodeId: string,
  nodes: CanvasNode[],
  edges: Edge[],
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node || node.type !== 'ai') return false;
  if (!node.threadDiscussionId || !node.threadDiscussionAgentIds?.length) return false;
  if (!(node.content ?? '').trim()) return false;

  const discussionId = node.threadDiscussionId;
  for (const edge of edges) {
    if (edge.from !== nodeId) continue;
    const child = byId.get(edge.to);
    if (child?.type === 'ai' && child.threadDiscussionId === discussionId) return false;
  }
  return true;
}

/** Agent card that started the discussion thread, if still linked to the first AI card. */
export function findDiscussionHubAgentId(
  chain: CanvasNode[],
  nodes: CanvasNode[],
  edges: Edge[],
): string | null {
  const first = chain[0];
  if (!first) return null;
  const incoming = edges.find((e) => e.to === first.id);
  if (!incoming) return null;
  const from = nodes.find((n) => n.id === incoming.from);
  return from?.type === 'agent' ? from.id : null;
}
