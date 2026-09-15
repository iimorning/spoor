import { db } from '../db';
import { isAiGeneratedImageNode } from '../utils/aiGeneratedImage';

/** Search-sourced image cards only — never auto-delete uploads / AI generations. */
export function isAutoRemovableSearchImage(
  node: Parameters<typeof isAiGeneratedImageNode>[0] & {
    type?: string;
    webSearchParentId?: string;
    webSearchIndex?: number;
  },
): boolean {
  if (node.type !== 'image') return false;
  if (isAiGeneratedImageNode(node)) return false;
  return Boolean(node.webSearchParentId) || typeof node.webSearchIndex === 'number';
}

/**
 * Drop a search image card whose `<img>` failed to load (hotlink / dead CDN).
 * Idempotent if the row is already gone.
 */
export async function removeBrokenSearchImageCard(nodeId: string): Promise<boolean> {
  const id = nodeId.trim();
  if (!id) return false;
  const node = await db.nodes.get(id);
  if (!node || !isAutoRemovableSearchImage(node)) return false;
  await db.transaction('rw', db.nodes, db.edges, async () => {
    await db.nodes.delete(id);
    await db.edges.where('from').equals(id).or('to').equals(id).delete();
  });
  console.info('[Spoor] removed broken search image card', {
    id,
    url: (node.content ?? '').slice(0, 120),
  });
  return true;
}
