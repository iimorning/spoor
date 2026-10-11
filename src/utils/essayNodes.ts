import { db, type Article, type CanvasNode } from '../db';
import { encodeEssayContent, ESSAY_NODE_SIZE, tryParseEssayContent } from './essayPayload';
import { stampNewCard } from './stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from './syncWorkZoneScopes';
import { setEssaySourcesCollapsed, uniqueEssaySourceNodeIds } from '../services/essaySourceStack';
import { countEssayChars } from './essayWordCount';

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
 * 文章的"同一篇"指纹。两篇算出同一个指纹，就是同一段文字的两个副本。
 *
 * **返回 null 的三种情况，都是故意不参与判同篇：**
 *
 * - `contentDrivesBody` 为假——正文还没接管，`content` 可能只是残留的旧值，
 *   这时候拿它比是在比垃圾。
 * - 正文一个字都没有——两个都是空白草稿的新长文，内容天然相同，判同篇会把
 *   用户的两篇草稿合并成一篇，那比多一张卡糟糕得多。纯图片的长文也落在这里
 *   （`countEssayChars` 剥掉 markdown 之后是 0）。
 * - 其他：正常算出指纹。
 *
 * 媒体 id 也进指纹：媒体不一样说明两篇经历过不同的插图过程，不是简单的复制。
 */
export function essayArticleFingerprint(article: Article | null | undefined): string | null {
  if (!article || article.contentDrivesBody !== true) return null;
  const text = article.content ?? '';
  if (countEssayChars(text) === 0) return null;
  const media = (article.media ?? []).map((m) => m.id).sort().join(',');
  return `${article.title ?? ''}\u0000${text}\u0000${media}`;
}

/**
 * 同一张画布上，哪些 essay 卡是同一篇的复制品。
 *
 * 为什么需要它：`dedupeEssayNodesByArticle` 按 articleId 分组，而 articleId 恰恰是
 * 复制品之间**唯一不同**的东西。同步分歧之后同一段文字会有两个 articleId，两个都
 * 各有一张卡，那套分组看不见它们是一对。
 *
 * 按画布分组是必须的：同一篇文章可以合法地出现在多张画布上（`linkedCanvasIds`
 * 就是数组），那是两个位置，不是两个副本。
 */
export async function findDuplicateEssayCardIds(): Promise<string[]> {
  const [essayNodes, articles] = await Promise.all([
    db.nodes.where('type').equals('essay').toArray(),
    db.articles.toArray(),
  ]);
  const byId = new Map(articles.map((a) => [String(a.id), a]));
  const groups = new Map<string, CanvasNode[]>();

  for (const node of essayNodes) {
    const articleId = tryParseEssayContent(node.content)?.articleId;
    if (!articleId) continue;
    const fingerprint = essayArticleFingerprint(byId.get(articleId));
    if (!fingerprint) continue;
    const key = `${(node.canvasId ?? 'default')}\u0000${fingerprint}`;
    const list = groups.get(key) ?? [];
    list.push(node);
    groups.set(key, list);
  }

  const toRemove: string[] = [];
  for (const nodes of groups.values()) {
    if (nodes.length < 2) continue;
    nodes.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));
    // 留最早建立的那张：它才是用户一路写过来的那张。
    for (const extra of nodes.slice(1)) toRemove.push(extra.id);
  }
  return toRemove;
}

/**
 * 这篇文章是不是已经有卡的孪生兄弟——同一张画布上，另有内容相同的一篇已经挂着卡。
 * 有的话就不该再给它补一张。
 */
export async function essayArticleHasCardTwin(
  article: Article,
  canvasId: string,
): Promise<boolean> {
  const fingerprint = essayArticleFingerprint(article);
  if (!fingerprint) return false;
  const [articles, essayNodes] = await Promise.all([
    db.articles.toArray(),
    db.nodes.where('type').equals('essay').toArray(),
  ]);
  const byId = new Map(articles.map((a) => [String(a.id), a]));
  return essayNodes.some((node) => {
    if ((node.canvasId ?? 'default') !== canvasId) return false;
    const id = tryParseEssayContent(node.content)?.articleId;
    if (!id || id === article.id) return false;
    return essayArticleFingerprint(byId.get(id)) === fingerprint;
  });
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

  // 复制品：articleId 不同，去重按 id 分组看不见它们是一对。
  for (const id of await findDuplicateEssayCardIds()) {
    if (!toRemove.includes(id)) toRemove.push(id);
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
