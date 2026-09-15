import { db, type CanvasNode } from '../db';
import { encodeEssayContent, ESSAY_NODE_SIZE, tryParseEssayContent } from './essayPayload';
import { stampNewCard } from './stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from './syncWorkZoneScopes';
import { setEssaySourcesCollapsed, uniqueEssaySourceNodeIds } from '../services/essaySourceStack';

/** Create an essay canvas card that points at an existing Article. */
export async function placeEssayNode(opts: {
  articleId: string;
  canvasId: string;
  x: number;
  y: number;
  title?: string;
  /** Synthesize source cards in generation/selection order (first on top when stacked). */
  sourceNodeIds?: string[];
  /** After placing, gather those sources into a photo pile beside this essay. */
  collapseSources?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  const sourceNodeIds = uniqueEssaySourceNodeIds(opts.sourceNodeIds ?? []).filter((sid) => sid !== id);
  const [essay] = await stampWorkZoneScopeOnNewNodes(
    [
      stampNewCard({
        id,
        canvasId: opts.canvasId,
        type: 'essay',
        content: encodeEssayContent({ articleId: opts.articleId }),
        description: opts.title?.trim() || undefined,
        x: opts.x,
        y: opts.y,
        width: ESSAY_NODE_SIZE.width,
        height: ESSAY_NODE_SIZE.height,
        ...(sourceNodeIds.length > 0
          ? {
              essaySourceNodeIds: sourceNodeIds,
              essaySourcesCollapsed: Boolean(opts.collapseSources),
            }
          : {}),
      }) as CanvasNode,
    ],
    opts.canvasId,
  );
  await db.nodes.add(essay);
  if (opts.collapseSources && sourceNodeIds.length > 0) {
    await setEssaySourcesCollapsed(id, true, { anchorHeight: ESSAY_NODE_SIZE.height });
  }
  return id;
}

/** Collect article ids linked from the given essay nodes (if any). */
export function articleIdsFromEssayNodes(
  nodes: { type: string; content?: string }[],
): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'essay') continue;
    const payload = tryParseEssayContent(node.content);
    if (payload) ids.add(payload.articleId);
  }
  return [...ids];
}

/** How many essay cards currently point at this article. */
export async function countEssayNodesForArticle(articleId: string): Promise<number> {
  const essayNodes = await db.nodes.where('type').equals('essay').toArray();
  return essayNodes.filter((n) => tryParseEssayContent(n.content)?.articleId === articleId).length;
}

/**
 * Article ids that should be deleted after removing `removing` essay nodes:
 * only those with no remaining essay card outside `removing`.
 */
export async function articleIdsOrphanedByRemovingEssayNodes(
  removing: { id: string; type: string; content?: string }[],
): Promise<string[]> {
  const candidateIds = articleIdsFromEssayNodes(removing);
  if (candidateIds.length === 0) return [];

  const removingIds = new Set(removing.map((n) => n.id));
  const remaining = (await db.nodes.where('type').equals('essay').toArray()).filter(
    (n) => !removingIds.has(n.id),
  );
  const stillLinked = new Set(articleIdsFromEssayNodes(remaining));
  return candidateIds.filter((id) => !stillLinked.has(id));
}

/**
 * Keep one essay card per articleId; delete extras (and their edges).
 * Prefer keeping the earliest-created-looking row (stable id sort as fallback).
 */
export async function dedupeEssayNodesByArticle(): Promise<{ removed: number }> {
  const essayNodes = await db.nodes.where('type').equals('essay').toArray();
  const byArticle = new Map<string, typeof essayNodes>();

  for (const node of essayNodes) {
    const articleId = tryParseEssayContent(node.content)?.articleId;
    if (!articleId) continue;
    const list = byArticle.get(articleId) ?? [];
    list.push(node);
    byArticle.set(articleId, list);
  }

  const toRemove: string[] = [];
  for (const nodes of byArticle.values()) {
    if (nodes.length < 2) continue;
    nodes.sort((a, b) => a.id.localeCompare(b.id));
    for (const extra of nodes.slice(1)) {
      toRemove.push(extra.id);
    }
  }

  if (toRemove.length === 0) return { removed: 0 };

  await db.transaction('rw', db.nodes, db.edges, async () => {
    await db.nodes.bulkDelete(toRemove);
    for (const id of toRemove) {
      await db.edges.where('from').equals(id).or('to').equals(id).delete();
    }
  });

  return { removed: toRemove.length };
}
