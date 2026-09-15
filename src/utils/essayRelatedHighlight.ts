import { db } from '../db';
import { tryParseEssayContent } from './essayPayload';

/**
 * Resolve essay card + its synthesize source cards that still exist on the
 * given canvas. Used for click-to-highlight related notes.
 */
export async function resolveEssayRelatedNodeIds(opts: {
  essayNodeId: string;
  canvasId: string;
  /** Optional live node id set on the current canvas (faster filter). */
  canvasNodeIds?: Set<string>;
}): Promise<Set<string>> {
  const essay = await db.nodes.get(opts.essayNodeId);
  const result = new Set<string>([opts.essayNodeId]);
  if (!essay || essay.type !== 'essay') return result;

  const payload = tryParseEssayContent(essay.content);
  if (!payload) return result;

  const article = await db.articles.get(payload.articleId);
  const sourceIds = (article?.sourceCards ?? []).map((s) => s.nodeId).filter(Boolean);
  if (sourceIds.length === 0) return result;

  let present: Set<string>;
  if (opts.canvasNodeIds) {
    present = opts.canvasNodeIds;
  } else {
    const onCanvas = await db.nodes
      .filter((n) => (n.canvasId ?? 'default') === opts.canvasId)
      .toArray();
    present = new Set(onCanvas.map((n) => n.id));
  }

  for (const id of sourceIds) {
    if (present.has(id)) result.add(id);
  }
  return result;
}
