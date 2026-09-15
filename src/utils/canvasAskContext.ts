import type { AgentConfig, CanvasNode, Edge } from '../db';

/**
 * BFS along undirected edges from {@param startId}; visited set doubles as
 * cycle guard. Returns the set of every reachable node id (excluding {@param
 * startId} itself). Used by one-time work-zone migration heuristics.
 */
export function collectReachableAskIds(startId: string, edges: Edge[]): Set<string> {
  const visited = new Set<string>([startId]);
  const queue: string[] = [];
  for (const edge of edges) {
    if (edge.from === startId && !visited.has(edge.to)) {
      visited.add(edge.to);
      queue.push(edge.to);
    } else if (edge.to === startId && !visited.has(edge.from)) {
      visited.add(edge.from);
      queue.push(edge.from);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      let neighbor: string | null = null;
      if (edge.from === id) neighbor = edge.to;
      else if (edge.to === id) neighbor = edge.from;
      if (neighbor && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  visited.delete(startId);
  return visited;
}

/** An agent card currently on the canvas that the toolbar mic can pin to. */
export interface CanvasVoicePersona {
  nodeId: string;
  agentConfigId: string;
  name: string;
  coverUrl?: string;
}

/** Agent cards on this canvas, in reading order (top → bottom, then left → right). */
export function listCanvasVoicePersonas(
  nodes: CanvasNode[],
  agentConfigs: AgentConfig[],
): CanvasVoicePersona[] {
  const byId = new Map(agentConfigs.map((a) => [a.id, a]));
  return nodes
    .filter((n) => n.type === 'agent' && n.agentConfigId && byId.has(n.agentConfigId))
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
    .map((n) => {
      const agent = byId.get(n.agentConfigId!)!;
      return {
        nodeId: n.id,
        agentConfigId: agent.id,
        name: agent.name,
        coverUrl: agent.coverImageUrl,
      };
    });
}

export function hasCanvasAskCard(nodes: CanvasNode[]): boolean {
  return nodes.some((n) => n.type === 'ask');
}

/**
 * Voice may offer 阿狸 only when an Ask card is already on the canvas.
 * Agent-only canvases must pin an agent so the mic does not spawn 阿狸 by mistake.
 */
export function coerceToolbarVoicePin(
  pinnedAgentNodeId: string | null,
  nodes: CanvasNode[] | undefined,
  personas: CanvasVoicePersona[],
): string | null {
  if (nodes === undefined) return pinnedAgentNodeId;
  const pinValid =
    Boolean(pinnedAgentNodeId) && personas.some((p) => p.nodeId === pinnedAgentNodeId);
  if (pinValid) return pinnedAgentNodeId;
  if (!hasCanvasAskCard(nodes) && personas.length > 0) {
    return personas[0]!.nodeId;
  }
  return null;
}

/** Toolbar mic thread root: a pinned agent card, otherwise the Ask card (阿狸).
 *  Agent-only canvases stay on an agent and never spawn 阿狸. Empty canvases
 *  still request a new Ask card. */
export function resolveToolbarVoiceThreadRoot(
  pinnedAgentNodeId: string | null,
  nodes: CanvasNode[],
): { rootId: string | null; needsAskCard: boolean } {
  if (pinnedAgentNodeId) {
    const onCanvas = nodes.some((n) => n.id === pinnedAgentNodeId && n.type === 'agent');
    if (onCanvas) return { rootId: pinnedAgentNodeId, needsAskCard: false };
  }
  const ask = nodes.find((n) => n.type === 'ask');
  if (ask) return { rootId: ask.id, needsAskCard: false };
  const agent = nodes
    .filter((n) => n.type === 'agent')
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))[0];
  if (agent) return { rootId: agent.id, needsAskCard: false };
  return { rootId: null, needsAskCard: true };
}

export function voicePinStorageKey(canvasId: string): string {
  return `spoor-voice-pin:${canvasId}`;
}

export function readStoredVoicePin(canvasId: string): string | null {
  try {
    return sessionStorage.getItem(voicePinStorageKey(canvasId));
  } catch {
    return null;
  }
}

export function writeStoredVoicePin(canvasId: string, agentNodeId: string | null): void {
  try {
    const key = voicePinStorageKey(canvasId);
    if (agentNodeId) sessionStorage.setItem(key, agentNodeId);
    else sessionStorage.removeItem(key);
  } catch {
    /* private mode / disabled storage */
  }
}

/**
 * Drop a toolbar pin only after the live node list has loaded and the agent
 * card is actually gone. `undefined` means Dexie is still resolving (including
 * a brief gap after writes) — treating that as "not on canvas" would snap the
 * picker back to 阿狸 after every turn.
 */
export function shouldClearVoicePin(
  pinnedAgentNodeId: string | null,
  nodes: CanvasNode[] | undefined,
): boolean {
  if (!pinnedAgentNodeId) return false;
  if (nodes === undefined) return false;
  return !nodes.some((n) => n.id === pinnedAgentNodeId && n.type === 'agent');
}
