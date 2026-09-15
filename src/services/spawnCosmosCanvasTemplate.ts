/**
 * Spawn the built-in "Trauma Inner Cosmos" canvas template into a fresh canvas.
 *
 * The cosmos starter layout is now data-driven (see
 * `src/constants/builtInCanvasTemplates.ts`); this file is a thin
 * wrapper that preserves the previous public signature and the legacy
 * `cosmos-${canvasId}-<key>` id prefix so that
 * `pruneRetiredCosmosThemeCards` continues to match node ids by suffix.
 */
import { db } from '../db';
import { getSystemCanvasTemplateByKey, materilizeTemplateForCanvas } from '../utils/canvasTemplate';

export async function spawnCosmosCanvasTemplate(canvasId: string): Promise<void> {
  const template = getSystemCanvasTemplateByKey('cosmos');
  if (!template) {
    throw new Error('Built-in cosmos template missing — builtInCanvasTemplates.ts is broken.');
  }

  // Stable prefix preserves the older `cosmos-${canvasId}-<key>` id format so
  // pruneRetiredCosmosThemeCards (and any saved bookmarks) keep working.
  const { nodes, edges } = materilizeTemplateForCanvas(template, canvasId, {
    idPrefix: `cosmos-${canvasId}-`,
  });

  await db.transaction('rw', db.nodes, db.edges, async () => {
    await db.nodes.bulkPut(nodes);
    await db.edges.bulkPut(edges);
  });
}

/** Cosmos theme cards removed in earlier versions of the cosmos template. */
const RETIRED_THEME_SUFFIXES = ['theme-entry', 'theme-props', 'theme-ritual'] as const;

/**
 * Remove retired template theme cards (Entry / Ritual / Scenes & props) from existing
 * cosmos canvases, and reconnect the four-questions note to Cosmos Weaver when needed.
 *
 * Unchanged from the pre-template implementation: the id prefix
 * `cosmos-${canvasId}-<key>` continues to come out of `spawnCosmosCanvasTemplate`.
 */
export async function pruneRetiredCosmosThemeCards(): Promise<{ removedNodes: number }> {
  const canvases = await db.canvases.filter((c) => c.template === 'cosmos').toArray();
  let removedNodes = 0;

  for (const canvas of canvases) {
    const prefix = `cosmos-${canvas.id}-`;
    const retiredSet = new Set(RETIRED_THEME_SUFFIXES.map((suffix) => `${prefix}${suffix}`));

    const nodes = await db.nodes.where('canvasId').equals(canvas.id).toArray();
    const nodeIdsToDelete = nodes.filter((n) => retiredSet.has(n.id)).map((n) => n.id);
    if (nodeIdsToDelete.length === 0) continue;

    const edges = await db.edges.where('canvasId').equals(canvas.id).toArray();
    const edgeIdsToDelete = edges
      .filter((e) => retiredSet.has(e.from) || retiredSet.has(e.to))
      .map((e) => e.id);

    const noteFourId = `${prefix}note-four`;
    const weaverId = `${prefix}agent-weaver`;
    const remainingNodeIds = new Set(nodes.filter((n) => !retiredSet.has(n.id)).map((n) => n.id));
    const remainingEdges = edges.filter((e) => !edgeIdsToDelete.includes(e.id));
    const shouldLinkFour =
      remainingNodeIds.has(noteFourId) &&
      remainingNodeIds.has(weaverId) &&
      !remainingEdges.some(
        (e) =>
          (e.from === noteFourId && e.to === weaverId) ||
          (e.from === weaverId && e.to === noteFourId),
      );

    await db.transaction('rw', db.nodes, db.edges, async () => {
      await db.nodes.bulkDelete(nodeIdsToDelete);
      if (edgeIdsToDelete.length > 0) {
        await db.edges.bulkDelete(edgeIdsToDelete);
      }
      if (shouldLinkFour) {
        await db.edges.put({
          id: `${prefix}e-four-weaver`,
          canvasId: canvas.id,
          from: noteFourId,
          to: weaverId,
        });
      }
    });

    removedNodes += nodeIdsToDelete.length;
  }

  return { removedNodes };
}
