import { db } from '../db';
import { articleIdsOrphanedByRemovingEssayNodes } from './essayNodes';
import { setAmbienceHiddenForCanvas } from './ensureAmbienceNode';

function belongsToCanvas(recordCanvasId: string | undefined, canvasId: string): boolean {
  if (recordCanvasId === canvasId) return true;
  return canvasId === 'default' && (recordCanvasId == null || recordCanvasId === '');
}

/** Permanently delete a canvas and every card/edge on it. No undo, no archive copy. */
export async function deleteCanvasWithContents(canvasId: string): Promise<void> {
  const [nodes, edges, workZones, personaThreads] = await Promise.all([
    db.nodes.filter((n) => belongsToCanvas(n.canvasId, canvasId)).toArray(),
    db.edges.filter((e) => belongsToCanvas(e.canvasId, canvasId)).toArray(),
    db.canvasWorkZones.filter((z) => belongsToCanvas(z.canvasId, canvasId)).toArray(),
    db.canvasPersonaThreads.filter((t) => belongsToCanvas(t.canvasId, canvasId)).toArray(),
  ]);

  await db.transaction(
    'rw',
    db.nodes,
    db.edges,
    db.canvases,
    db.articles,
    db.canvasWorkZones,
    db.canvasPersonaThreads,
    async () => {
      const orphanedArticles = await articleIdsOrphanedByRemovingEssayNodes(nodes);
      if (nodes.length > 0) await db.nodes.bulkDelete(nodes.map((n) => n.id));
      if (edges.length > 0) await db.edges.bulkDelete(edges.map((e) => e.id));
      if (orphanedArticles.length > 0) await db.articles.bulkDelete(orphanedArticles);
      if (workZones.length > 0) await db.canvasWorkZones.bulkDelete(workZones.map((z) => z.id));
      if (personaThreads.length > 0) {
        await db.canvasPersonaThreads.bulkDelete(personaThreads.map((t) => t.id));
      }
      await db.canvases.delete(canvasId);
    },
  );

  setAmbienceHiddenForCanvas(canvasId, false);
}
