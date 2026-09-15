import { db, type CanvasNode, type CanvasWorkZone } from '../db';
import { isPersonaAnchorNode } from './agentWorkZone';
import { isCanvasV2Enabled } from './canvasV2';
import { findPersonaForNodeInZones } from './workZoneGeometry';

/** Reconcile `contextScopeAgentId` for every card from drawn work zones. */
export async function reconcileNodeScopesFromZones(
  nodes: CanvasNode[],
  zones: CanvasWorkZone[],
): Promise<void> {
  for (const node of nodes) {
    if (isPersonaAnchorNode(node)) continue;
    const personaId = findPersonaForNodeInZones(node, zones);
    if (personaId === node.contextScopeAgentId) continue;
    await db.nodes.update(node.id, {
      contextScopeAgentId: personaId ?? undefined,
    });
  }
}

/**
 * Assign (or clear) work-zone scope for a card being created or pasted at a
 * world position — same rule as drag-end, without waiting for a later drag.
 */
export function stampWorkZoneScopeOnNewNode<T extends CanvasNode>(
  node: T,
  zones: CanvasWorkZone[],
): T {
  if (isPersonaAnchorNode(node)) {
    if (!node.contextScopeAgentId) return node;
    return { ...node, contextScopeAgentId: undefined };
  }
  const personaId = findPersonaForNodeInZones(node, zones);
  if (personaId === node.contextScopeAgentId) return node;
  return { ...node, contextScopeAgentId: personaId };
}

/** Load this canvas's rooms and stamp scope on new cards (no-op when V2 is off). */
export async function stampWorkZoneScopeOnNewNodes<T extends CanvasNode>(
  nodes: T[],
  canvasId: string,
): Promise<T[]> {
  if (nodes.length === 0 || !isCanvasV2Enabled()) return nodes;
  const zones = await db.canvasWorkZones.where('canvasId').equals(canvasId).toArray();
  return nodes.map((node) => stampWorkZoneScopeOnNewNode(node, zones));
}
