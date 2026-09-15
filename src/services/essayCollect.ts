import { db, type ArticleMedia, type CanvasNode, type SourceCardSegment } from '../db';
import { estimateNodeRect, rectOverlapRatio, type CanvasRect } from '../utils/canvas';
import {
  articleMediaIdFromUrl,
  articleMediaUrl,
  dataImageUrlToBlob,
} from '../utils/articleMedia';
import { sameOriginCdnProxyUrl } from '../utils/aiGeneratedImage';
import { essayUrlTransform } from '../utils/essayUrlTransform';
import { tryParseEssayContent } from '../utils/essayPayload';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { mediaMarkdownFromNode } from '../utils/publishSourceMaterial';
import {
  browserSearchImageProxyUrl,
  fetchSearchImageBlobUrl,
  searchImageReferer,
} from './searchImageSrc';
import { setEssaySourcesCollapsed, uniqueEssaySourceNodeIds } from './essaySourceStack';

export const ESSAY_SOURCE_DRAG_MIME = 'application/x-spoor-essay-source';

/** Dropped card must cover this fraction of the essay (or vice versa) to collect. */
export const ESSAY_COLLECT_SNAP_RATIO = 0.22;

export function isEssayCollectable(node: CanvasNode): boolean {
  if (node.type === 'essay') return false;
  if (node.type === 'ambience') return false;
  return true;
}

function isDataUrl(s: string): boolean {
  return /^data:/i.test(s.trim());
}

export function sourceCardFromCanvasNode(node: CanvasNode): SourceCardSegment {
  const media = mediaMarkdownFromNode(node);
  const raw = (node.content || '').trim();
  const usable = raw && !isDataUrl(raw) ? raw : '';
  const segmentText = (media?.articleMarkdown || usable || (node.description || '').trim()).trim();
  const titleFrom = (usable || (node.description || '').replace(/\s+/g, ' ').trim()).slice(0, 40);
  return {
    nodeId: node.id,
    canvasId: node.canvasId ?? '',
    kind: node.type || 'card',
    title: titleFrom || node.type || 'card',
    segmentText,
    inBody: false,
  };
}

export function sourceCardPreviewImageSrc(
  segmentText: string,
  mediaUrls: Record<string, string>,
): string {
  const match = /!\[[^\]]*]\(([^)\s]+)\)/.exec(segmentText ?? '');
  if (!match) return '';
  const src = match[1]!.trim();
  const mediaId = articleMediaIdFromUrl(src);
  if (mediaId) return mediaUrls[mediaId] || '';
  return essayUrlTransform(src);
}

function nextArticleMediaId(nodeId: string, existing: ArticleMedia[]): string {
  const preferred = `node-${nodeId}`;
  if (!existing.some((item) => item.id === preferred)) return preferred;
  return `node-${nodeId}-${existing.length}`;
}

async function resolveCanvasImageBlob(node: CanvasNode): Promise<Blob | null> {
  const src = (node.content || '').trim();
  if (!src) return null;
  if (/^data:image\//i.test(src)) {
    try {
      return await dataImageUrlToBlob(src);
    } catch {
      return null;
    }
  }
  if (!/^https?:\/\//i.test(src)) return null;
  const isSearch = Boolean(node.webSearchParentId) || typeof node.webSearchIndex === 'number';
  const referer = searchImageReferer(src, node.sourceUrl);
  if (isSearch && isTauriRuntime()) {
    try {
      const objectUrl = await fetchSearchImageBlobUrl(src, referer);
      const blob = await (await fetch(objectUrl)).blob();
      URL.revokeObjectURL(objectUrl);
      if (blob.size > 0) return blob;
    } catch {
      // fall through to HTTP candidates
    }
  }
  const candidates: string[] = [];
  if (isSearch && !isTauriRuntime()) {
    candidates.push(browserSearchImageProxyUrl(src, referer));
  }
  const cdn = sameOriginCdnProxyUrl(src);
  if (cdn) candidates.push(cdn);
  candidates.push(src);
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size === 0) continue;
      if (blob.type.startsWith('image/')) return blob;
      if (blob.type === 'application/octet-stream' || !blob.type) {
        return new Blob([blob], { type: 'image/jpeg' });
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function collectSourceFromNode(
  node: CanvasNode,
  existingMedia: ArticleMedia[],
): Promise<{ card: SourceCardSegment; media?: ArticleMedia }> {
  const card = sourceCardFromCanvasNode(node);
  if (node.type !== 'image') return { card };
  const blob = await resolveCanvasImageBlob(node);
  if (!blob) return { card };
  const id = nextArticleMediaId(node.id, existingMedia);
  const alt = (card.title || node.description || 'Image').replace(/[[\]]/g, '').trim() || 'Image';
  return {
    card: {
      ...card,
      segmentText: `![${alt}](${articleMediaUrl(id)})`,
    },
    media: {
      id,
      sourceNodeId: node.id,
      mimeType: blob.type || 'image/png',
      blob,
    },
  };
}

export function pickEssayCollectTarget(
  draggedId: string,
  draggedRect: CanvasRect,
  nodes: CanvasNode[],
  excludeIds: Set<string>,
): CanvasNode | null {
  const dragged = nodes.find((n) => n.id === draggedId);
  if (!dragged || !isEssayCollectable(dragged)) return null;
  let best: CanvasNode | null = null;
  let bestRatio = ESSAY_COLLECT_SNAP_RATIO;
  for (const other of nodes) {
    if (other.id === draggedId || excludeIds.has(other.id)) continue;
    if (other.type !== 'essay') continue;
    const ratio = rectOverlapRatio(draggedRect, estimateNodeRect(other));
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = other;
    }
  }
  return best;
}

export async function collectNodesIntoEssay(options: {
  essayNodeId: string;
  sourceIds: string[];
  nodes: CanvasNode[];
}): Promise<string[]> {
  const essay =
    options.nodes.find((n) => n.id === options.essayNodeId) ??
    (await db.nodes.get(options.essayNodeId));
  if (!essay || essay.type !== 'essay') return [];
  const articleId = tryParseEssayContent(essay.content)?.articleId;
  if (!articleId) return [];
  const article = await db.articles.get(articleId);
  if (!article) return [];

  const existing = new Set((article.sourceCards ?? []).map((s) => s.nodeId));
  const collected: SourceCardSegment[] = [];
  const addedMedia: ArticleMedia[] = [];
  const existingMedia = [...(article.media ?? [])];
  const newIds: string[] = [];
  for (const id of uniqueEssaySourceNodeIds(options.sourceIds)) {
    if (id === essay.id || existing.has(id)) continue;
    const node =
      options.nodes.find((n) => n.id === id) ?? (await db.nodes.get(id));
    if (!node || !isEssayCollectable(node)) continue;
    const ingested = await collectSourceFromNode(node, existingMedia);
    collected.push(ingested.card);
    if (ingested.media) {
      addedMedia.push(ingested.media);
      existingMedia.push(ingested.media);
    }
    newIds.push(id);
    existing.add(id);
  }
  if (collected.length === 0) return [];

  const nextCards = [...(article.sourceCards ?? []), ...collected];
  const nextSourceIds = uniqueEssaySourceNodeIds([
    ...(essay.essaySourceNodeIds ?? (article.sourceCards ?? []).map((s) => s.nodeId)),
    ...newIds,
  ]);

  await db.articles.update(articleId, {
    sourceCards: nextCards,
    ...(addedMedia.length > 0 ? { media: [...(article.media ?? []), ...addedMedia] } : {}),
  });
  await db.nodes.update(essay.id, { essaySourceNodeIds: nextSourceIds });
  await setEssaySourcesCollapsed(essay.id, true, {
    nodes: options.nodes.map((n) =>
      n.id === essay.id ? { ...n, essaySourceNodeIds: nextSourceIds } : n,
    ),
  });
  return newIds;
}

/** Fill missing article media for collected image cards (e.g. inbox entries created before ingest). */
export async function repairEssayCollectedMedia(articleId: string): Promise<void> {
  const article = await db.articles.get(articleId);
  if (!article?.sourceCards?.length) return;
  const media = [...(article.media ?? [])];
  let changed = false;
  const nextCards = [...article.sourceCards];
  for (let i = 0; i < nextCards.length; i++) {
    const card = nextCards[i]!;
    const srcMatch = /!\[[^\]]*]\(([^)\s]+)\)/.exec(card.segmentText ?? '');
    const rawSrc = srcMatch?.[1]?.trim() ?? '';
    const mediaId = articleMediaIdFromUrl(rawSrc);
    if (mediaId && media.some((item) => item.id === mediaId)) continue;
    const looksLikeImage =
      card.kind === 'image' || Boolean(srcMatch) || /^https?:\/\//i.test(rawSrc) || /^data:image\//i.test(rawSrc);
    if (!looksLikeImage) continue;
    const node = await db.nodes.get(card.nodeId);
    if (!node || node.type !== 'image') continue;
    const ingested = await collectSourceFromNode(node, media);
    if (!ingested.media) continue;
    media.push(ingested.media);
    nextCards[i] = { ...card, segmentText: ingested.card.segmentText, kind: card.kind || 'image' };
    changed = true;
  }
  if (!changed) return;
  await db.articles.update(articleId, { sourceCards: nextCards, media });
}
