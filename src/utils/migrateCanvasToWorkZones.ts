import { db } from '../db';
import type { CanvasNode, Edge } from '../db';
import { getMigratedWorkZoneCanvasIds, markCanvasWorkZoneMigrated } from './canvasV2';
import { inferWorkZoneAssignments } from './agentWorkZone';

export type WorkZoneMigrationResult = {
  assigned: number;
  skipped: number;
};

/**
 * One-time per canvas: infer `contextScopeAgentId` from legacy edge wiring.
 * Does not remove edges.
 */
export async function migrateCanvasToWorkZones(
  canvasId: string,
  nodes: CanvasNode[],
  edges: Edge[],
): Promise<WorkZoneMigrationResult> {
  if (getMigratedWorkZoneCanvasIds().has(canvasId)) {
    return { assigned: 0, skipped: nodes.length };
  }

  const canvasNodes = nodes.filter((n) => n.canvasId === canvasId || !n.canvasId);
  const canvasEdges = edges.filter((e) => e.canvasId === canvasId || !e.canvasId);
  const assignments = inferWorkZoneAssignments(canvasNodes, canvasEdges);

  let assigned = 0;
  await db.transaction('rw', db.nodes, async () => {
    for (const [nodeId, agentId] of assignments) {
      const node = canvasNodes.find((n) => n.id === nodeId);
      if (!node || node.contextScopeAgentId) continue;
      await db.nodes.update(nodeId, { contextScopeAgentId: agentId });
      assigned++;
    }
  });

  markCanvasWorkZoneMigrated(canvasId);
  return { assigned, skipped: canvasNodes.length - assigned };
}
