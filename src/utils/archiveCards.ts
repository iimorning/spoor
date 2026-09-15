import { db, type ArchivedCard, type Article, type CanvasNode } from '../db';
import { tryParseBookContent } from './bookPayload';
import { encodeEssayContent, tryParseEssayContent } from './essayPayload';
import { tryParseAmbienceContent } from './ambiencePayload';
import { getCanvasNodeSearchText } from './canvasNodeSearch';
import { getAmbienceScene } from '../data/ambienceCatalog';
import i18n from '../i18n';
import { stampNewCard } from './stampNewCard';
import { essayBodyMarkdown } from './essayWordCount';
import { pocketNotePreview, pocketNoteTitle } from './pocketNotes';

/** Card types that expose the archive chrome control. */
export const ARCHIVABLE_NODE_TYPES = new Set([
  'note',
  'text',
  'theme',
  'ai',
  'essay',
  'document',
  'book',
  'image',
  'video',
]);

export function isArchivableNodeType(type: string | undefined): boolean {
  return !!type && ARCHIVABLE_NODE_TYPES.has(type);
}

export interface ArchiveListItem {
  id: string;
  archivedAt: number;
  /** Locale-formatted card date (from node.createdAt or archivedAt). */
  dateLabel: string;
  title: string;
  /** Full readable body for archive browsing (not a truncated preview). */
  body: string;
  type: string;
  /** Image data URL when type is image; otherwise null. */
  thumbnailUrl: string | null;
  searchText: string;
  folderId?: string;
  /** Phone capture memo waiting to be pinned; not a canvas-archive snapshot. */
  origin?: 'pocket';
}

function stripMd(text: string): string {
  return text
    .replace(/[#>*`\[\]()!|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstLineTitle(text: string, maxLen = 72): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
}

function formatArchiveCardDate(ms: number): string {
  const locale = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
  return new Date(ms).toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function buildArchiveListItem(entry: ArchivedCard): ArchiveListItem {
  const node = entry.node;
  const createdAt = node.createdAt ?? entry.archivedAt;
  const dateLabel = formatArchiveCardDate(createdAt);
  let title = '';
  let body = '';
  let thumbnailUrl: string | null = null;

  if (node.type === 'essay' && entry.article) {
    title = entry.article.title?.trim() || node.description?.trim() || '';
    body = essayBodyMarkdown(entry.article).trim();
  } else if (node.type === 'book') {
    const book = tryParseBookContent(node.content);
    title = book?.title?.trim() || node.description?.trim() || '';
    body = (book?.units ?? []).map((u) => u.text?.trim() ?? '').filter(Boolean).join('\n\n');
  } else if (node.type === 'image') {
    title = node.description?.trim() || '';
    const c = node.content?.trim() ?? '';
    if (c.startsWith('data:') || /^https?:\/\//i.test(c)) thumbnailUrl = c;
    body = '';
  } else if (node.type === 'video') {
    title = node.description?.trim() || firstLineTitle(node.content ?? '') || '';
    body = node.content?.trim() ?? '';
  } else if (node.type === 'theme') {
    title = node.content?.trim() || node.description?.trim() || '';
    body = [node.themeTag, node.content].filter(Boolean).join('\n\n');
  } else if (node.type === 'ambience') {
    const amb = tryParseAmbienceContent(node.content);
    const scene = getAmbienceScene(amb?.trackId);
    title = node.description?.trim() || i18n.t(scene.titleKey);
    body = i18n.t(scene.subtitleKey);
  } else if (node.type === 'ai') {
    const reply = (node.content ?? '').trim();
    const turn = (node.userTurn ?? '').trim();
    title = firstLineTitle(stripMd(turn || reply)) || '';
    body = [turn, reply].filter(Boolean).join('\n\n');
  } else {
    const raw = (node.content ?? '').trim();
    title = node.description?.trim() || firstLineTitle(stripMd(raw)) || '';
    body = raw;
  }

  if (!title) title = node.type;

  const searchParts = [
    title,
    body,
    node.type,
    entry.sourceCanvasName ?? '',
    entry.article ? getCanvasNodeSearchText({ ...node, description: entry.article.title }) : getCanvasNodeSearchText(node),
    entry.article?.content ?? '',
    entry.article?.title ?? '',
  ];

  return {
    id: entry.id,
    archivedAt: entry.archivedAt,
    dateLabel,
    title,
    body,
    type: node.type,
    thumbnailUrl,
    searchText: searchParts.join('\n').toLowerCase(),
    folderId: entry.folderId,
  };
}

export function filterAndSortArchiveItems(
  items: ArchiveListItem[],
  query: string,
): ArchiveListItem[] {
  const q = query.trim().toLowerCase();
  const out = q ? items.filter((it) => it.searchText.includes(q) || it.title.toLowerCase().includes(q)) : [...items];
  out.sort((a, b) => b.archivedAt - a.archivedAt);
  return out;
}

export const POCKET_ARCHIVE_ID_PREFIX = 'pocket:';

export function isPocketArchiveItemId(id: string): boolean {
  return id.startsWith(POCKET_ARCHIVE_ID_PREFIX);
}

export function pocketNodeIdFromArchiveItem(id: string): string {
  return id.slice(POCKET_ARCHIVE_ID_PREFIX.length);
}

export function buildPocketArchiveListItem(node: CanvasNode): ArchiveListItem {
  const body = pocketNotePreview(node.content);
  const title = pocketNoteTitle(node.content) || i18n.t('pocket.untitled');
  const createdAt = node.createdAt ?? 0;
  return {
    id: `${POCKET_ARCHIVE_ID_PREFIX}${node.id}`,
    archivedAt: createdAt,
    dateLabel: formatArchiveCardDate(createdAt || Date.now()),
    title,
    body,
    type: node.type || 'note',
    thumbnailUrl: null,
    searchText: [title, body].join('\n').toLowerCase(),
    origin: 'pocket',
  };
}

/**
 * Snapshot a canvas node into the archive library for later reuse.
 * The original card (and its essay article) stay on the canvas.
 * `folderId` places the snapshot in a custom folder; omit / null = unfiled.
 */
export async function archiveNode(nodeId: string, folderId?: string | null): Promise<ArchivedCard> {
  const node = await db.nodes.get(nodeId);
  if (!node) throw new Error('Node not found');
  if (!isArchivableNodeType(node.type)) throw new Error(`Type "${node.type}" cannot be archived`);

  let article: Article | undefined;
  const essayPayload = node.type === 'essay' ? tryParseEssayContent(node.content) : null;
  if (essayPayload) {
    article = (await db.articles.get(essayPayload.articleId)) ?? undefined;
  }

  const canvasId = node.canvasId;
  const canvas = canvasId ? await db.canvases.get(canvasId) : undefined;

  if (folderId) {
    const folder = await db.archiveFolders.get(folderId);
    if (!folder) throw new Error('Folder not found');
  }

  const entry: ArchivedCard = {
    id: crypto.randomUUID(),
    archivedAt: Date.now(),
    sourceCanvasId: canvasId,
    sourceCanvasName: canvas?.name,
    node: { ...node },
    ...(article ? { article: { ...article } } : {}),
    ...(folderId ? { folderId } : {}),
  };

  await db.archivedCards.add(entry);
  return entry;
}

/**
 * Copy an archived card onto a canvas as a new node (archive entry kept).
 * Returns the new canvas node id.
 */
export async function restoreArchivedCard(
  archiveId: string,
  canvasId: string,
  position: { x: number; y: number },
): Promise<string> {
  const entry = await db.archivedCards.get(archiveId);
  if (!entry) throw new Error('Archive entry not found');

  const newNodeId = crypto.randomUUID();
  const snap = entry.node;

  if (snap.type === 'essay') {
    const newArticleId = crypto.randomUUID();
    const article: Article = entry.article
      ? { ...entry.article, id: newArticleId }
      : {
          id: newArticleId,
          title: snap.description?.trim() || 'Untitled',
          content: '',
          date: String(new Date().getFullYear()),
          type: 'REF',
          tags: [],
          linkedCanvasIds: [canvasId],
        };
    if (!article.linkedCanvasIds?.includes(canvasId)) {
      article.linkedCanvasIds = [...(article.linkedCanvasIds ?? []), canvasId];
    }

    const node: CanvasNode = {
      ...snap,
      id: newNodeId,
      canvasId,
      x: position.x,
      y: position.y,
      content: encodeEssayContent({ articleId: newArticleId }),
      description: article.title,
    };

    await db.transaction('rw', db.nodes, db.articles, async () => {
      await db.articles.put(article);
      await db.nodes.add(stampNewCard(node));
    });
    return newNodeId;
  }

  const node: CanvasNode = {
    ...snap,
    id: newNodeId,
    canvasId,
    x: position.x,
    y: position.y,
  };
  // Drop thread / web-search parent links that point at missing canvas cards.
  delete node.webSearchParentId;
  delete node.webSearchIndex;
  delete node.webSearchExpandedOffsetX;
  delete node.webSearchExpandedOffsetY;
  delete node.bookExpandParentId;
  delete node.bookExpandIndex;
  delete node.bookExpandExpandedOffsetX;
  delete node.bookExpandExpandedOffsetY;
  delete node.threadRootContextNodeId;
  delete node.threadAgentConfigId;
  delete node.turtleSoupRound;
  delete node.threadContextImageNodeIds;
  delete node.threadRound;
  delete node.askThreadCollapsed;
  delete node.askThreadExpandedOffsetX;
  delete node.askThreadExpandedOffsetY;
  delete node.essaySourcesCollapsed;
  delete node.essaySourceNodeIds;
  delete node.essaySourceParentId;
  delete node.essaySourceIndex;
  delete node.essaySourceExpandedOffsetX;
  delete node.essaySourceExpandedOffsetY;
  delete node.notePileCollapsed;
  delete node.notePileMemberIds;
  delete node.notePileOriginX;
  delete node.notePileOriginY;
  delete node.notePileParentId;
  delete node.notePileIndex;
  delete node.notePileExpandedOffsetX;
  delete node.notePileExpandedOffsetY;
  delete node.threadDiscussionId;
  delete node.threadDiscussionAgentIds;
  delete node.threadDiscussionTurnIndex;

  await db.nodes.add(stampNewCard(node));
  return newNodeId;
}

export async function deleteArchivedCard(archiveId: string): Promise<void> {
  await db.archivedCards.delete(archiveId);
}

/**
 * Persist a knowledge-graph insight as a new archived note in the hub card's folder.
 */
export async function saveArchivedInsight(opts: {
  hubId: string;
  text: string;
  title: string;
}): Promise<ArchivedCard> {
  const content = opts.text.trim();
  if (!content) throw new Error('Insight text is empty');
  const hub = await db.archivedCards.get(opts.hubId);
  const title = opts.title.trim() || 'Insight';
  const entry: ArchivedCard = {
    id: crypto.randomUUID(),
    archivedAt: Date.now(),
    sourceCanvasId: hub?.sourceCanvasId,
    sourceCanvasName: hub?.sourceCanvasName,
    node: stampNewCard({
      id: crypto.randomUUID(),
      type: 'note',
      content,
      description: title,
      x: 0,
      y: 0,
    }),
    ...(hub?.folderId ? { folderId: hub.folderId } : {}),
  };
  await db.archivedCards.add(entry);
  return entry;
}
