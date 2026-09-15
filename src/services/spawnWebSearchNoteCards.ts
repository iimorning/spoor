import { db, type CanvasNode, type Edge } from '../db';
import { stampNewCard } from '../utils/stampNewCard';
import type { MetasoImage, MetasoMediaItem, MetasoWebpage } from './search';
import { resolveMetasoImageUrl } from './search';
import { resolveMediaPlayback } from '../utils/mediaEmbed';
import {
  buildWebSearchMediaRelation,
  formatSearchMediaDescription,
  type WebSearchRelationContext,
} from '../utils/webSearchMediaCaption';

const DEFAULT_STAGGER_MS = 320;
/** Sources live in a dedicated vertical lane beside the answer, never in a fan of overlaps. */
export const SOURCE_LANE_OFFSET_X = 380;
export const SOURCE_ROW_GAP_Y = 240;
export const SOURCE_CARD_WIDTH = 320;
export const SOURCE_CARD_HEIGHT = 210;
/** Extra height when a webpage source card shows a preview image. */
export const SOURCE_CARD_PREVIEW_EXTRA = 112;
/** Neat deck offset when sources are collapsed (keep small so the pile stays tidy). */
export const SOURCE_STACK_STEP = 5;
/** Fallback when the answer card height is not measured yet (streaming / just created). */
export const DEFAULT_ANCHOR_HEIGHT = 280;

/**
 * Image expand: cluster center X relative to the parent card's left edge.
 * Far enough that a typical ~320px note stays readable (scatter sits to its right).
 */
export const IMAGE_SCATTER_OFFSET_X = 780;
/** Golden-angle step for an organic, non-grid scatter. */
const IMAGE_SCATTER_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Soft tilts (deg) so expanded images read as a loose overlapping pile. */
const IMAGE_SCATTER_TILTS = [-4.5, 3.2, -2.1, 5.0, -3.6, 2.4, -5.2, 1.8];

/**
 * Use the first non-empty line of the draft (cap length) as the Metaso query.
 */
export function deriveSearchQueryFromNoteText(text: string, maxLen = 280): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  const line = normalized.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen);
}

/**
 * Y of source card `index` so the whole lane is vertically centered on the answer card.
 * Tall stacks extend equally above and below the answer instead of hanging from its top edge.
 */
export function sourceCardY(
  baseY: number,
  index: number,
  count: number,
  anchorHeight = DEFAULT_ANCHOR_HEIGHT,
): number {
  const n = Math.max(count, 1);
  const stackHeight = (n - 1) * SOURCE_ROW_GAP_Y + SOURCE_CARD_HEIGHT;
  const centerY = baseY + Math.max(anchorHeight, 1) / 2;
  const firstY = centerY - stackHeight / 2;
  return firstY + index * SOURCE_ROW_GAP_Y;
}

export function sourceCardStackPos(
  base: { x: number; y: number },
  index: number,
  _count = 1,
  anchorHeight = DEFAULT_ANCHOR_HEIGHT,
): { x: number; y: number } {
  const centerY = base.y + Math.max(anchorHeight, 1) / 2;
  // Front card (index 0) at the anchor; each deeper card peeks a few px bottom-right.
  return {
    x: base.x + SOURCE_LANE_OFFSET_X + index * SOURCE_STACK_STEP,
    y: centerY - SOURCE_CARD_HEIGHT / 2 + index * SOURCE_STACK_STEP,
  };
}

/** Higher z for earlier sources so #1 sits on top of the neat deck. */
export function sourceStackZIndex(index: number): number {
  return 420 - index;
}

export function isWebSearchSourceNode(node: CanvasNode): boolean {
  if (node.webSearchParentId) return true;
  if (node.type === 'image' && typeof node.webSearchIndex === 'number') return true;
  if (node.type !== 'text' && node.type !== 'note') return false;
  if (node.layout !== 2) return false;
  return /^###\s*\d+\./m.test((node.content ?? '').trim());
}

export function webSearchSourceIndex(node: CanvasNode): number {
  if (typeof node.webSearchIndex === 'number') return node.webSearchIndex;
  const m = /^###\s*(\d+)\./m.exec((node.content ?? '').trim());
  return m ? Math.max(0, Number.parseInt(m[1]!, 10) - 1) : 0;
}

export function listWebSearchSourcesForParent(
  parentId: string,
  nodes: CanvasNode[],
  edges: Pick<Edge, 'from' | 'to'>[],
): CanvasNode[] {
  const childIds = new Set(edges.filter((e) => e.from === parentId).map((e) => e.to));
  return nodes
    .filter((n) => {
      if (!childIds.has(n.id)) return false;
      if (n.webSearchParentId === parentId) return true;
      if (n.webSearchParentId) return false;
      if (n.type === 'image') return typeof n.webSearchIndex === 'number';
      return isWebSearchSourceNode(n);
    })
    .sort((a, b) => webSearchSourceIndex(a) - webSearchSourceIndex(b));
}

/** Keep stacked cards upright — tilt made the pile look scattered. */
export function sourceStackTiltDeg(_index: number): number {
  return 0;
}

export function isImageSearchSources(sources: Pick<CanvasNode, 'type'>[]): boolean {
  return sources.length > 0 && sources.every((s) => s.type === 'image');
}

/**
 * Expanded image layout: a roomy, lightly overlapping scatter
 * (not a vertical lane, not a tight pile on top of the parent).
 */
export function sourceImageScatterPos(
  base: { x: number; y: number },
  index: number,
  count: number,
  anchorHeight = DEFAULT_ANCHOR_HEIGHT,
): { x: number; y: number } {
  const centerX = base.x + IMAGE_SCATTER_OFFSET_X;
  const centerY = base.y + Math.max(anchorHeight, 1) / 2;
  const n = Math.max(count, 1);

  if (n === 1) {
    return {
      x: Math.round(centerX - SOURCE_CARD_WIDTH / 2),
      y: Math.round(centerY - SOURCE_CARD_HEIGHT / 2),
    };
  }

  // Wider ring: air between cards, only light overlap; grows with count.
  const maxR = 170 + Math.min(n, 8) * 34;
  // Keep the first card off-center so nothing parks on the cluster origin.
  const r = maxR * Math.sqrt((index + 0.9) / (n + 0.35));
  const angle = index * IMAGE_SCATTER_GOLDEN_ANGLE - Math.PI / 6;
  return {
    x: Math.round(centerX + Math.cos(angle) * r - SOURCE_CARD_WIDTH / 2),
    y: Math.round(centerY + Math.sin(angle) * r - SOURCE_CARD_HEIGHT / 2),
  };
}

/** Slight tilt for expanded image scatter; stacked deck stays upright via `sourceStackTiltDeg`. */
export function sourceImageScatterTiltDeg(index: number): number {
  return IMAGE_SCATTER_TILTS[((index % IMAGE_SCATTER_TILTS.length) + IMAGE_SCATTER_TILTS.length) % IMAGE_SCATTER_TILTS.length]!;
}

function defaultExpandedPos(
  base: { x: number; y: number },
  index: number,
  count: number,
  anchorHeight: number,
  imageScatter: boolean,
): { x: number; y: number } {
  if (imageScatter) {
    return sourceImageScatterPos(base, index, count, anchorHeight);
  }
  return {
    x: base.x + SOURCE_LANE_OFFSET_X,
    y: sourceCardY(base.y, index, count, anchorHeight),
  };
}

function resolveExpandedPos(
  source: CanvasNode,
  base: { x: number; y: number },
  index: number,
  count: number,
  anchorHeight: number,
  imageScatter: boolean,
): { x: number; y: number } {
  const ox = source.webSearchExpandedOffsetX;
  const oy = source.webSearchExpandedOffsetY;
  if (typeof ox === 'number' && typeof oy === 'number' && Number.isFinite(ox) && Number.isFinite(oy)) {
    return { x: base.x + ox, y: base.y + oy };
  }
  return defaultExpandedPos(base, index, count, anchorHeight, imageScatter);
}

/**
 * Collapse sources into a photo stack, or expand:
 * - image hits → loose overlapping scatter (or last user layout)
 * - text sources → vertical lane (or last user layout)
 *
 * On collapse, each source's current position is stored as an offset from the parent
 * so a later expand restores manual rearrangements instead of the algorithm defaults.
 */
export async function setWebSearchSourcesCollapsed(
  parentId: string,
  collapsed: boolean,
  options?: {
    nodes?: CanvasNode[];
    edges?: Pick<Edge, 'from' | 'to'>[];
    anchorHeight?: number;
  },
): Promise<number> {
  const parent = await db.nodes.get(parentId);
  if (!parent) return 0;

  const nodes = options?.nodes ?? (await db.nodes.toArray());
  const edges = options?.edges ?? (await db.edges.toArray());
  const sources = listWebSearchSourcesForParent(parentId, nodes, edges);
  if (sources.length === 0) return 0;

  const anchorHeight = options?.anchorHeight ?? parent.height ?? DEFAULT_ANCHOR_HEIGHT;
  const imageScatter = isImageSearchSources(sources);

  await db.transaction('rw', db.nodes, async () => {
    // Prefer live DB rows so expand restores offsets written on the previous collapse,
    // even if the caller's in-memory `nodes` snapshot is briefly stale.
    const freshParent = (await db.nodes.get(parentId)) ?? parent;
    const base = { x: freshParent.x, y: freshParent.y };
    await db.nodes.update(parentId, { webSearchSourcesCollapsed: collapsed });
    for (let i = 0; i < sources.length; i++) {
      const listed = sources[i]!;
      const source = (await db.nodes.get(listed.id)) ?? listed;
      if (collapsed) {
        const stackPos = sourceCardStackPos(base, i, sources.length, anchorHeight);
        await db.nodes.update(source.id, {
          ...stackPos,
          webSearchExpandedOffsetX: source.x - base.x,
          webSearchExpandedOffsetY: source.y - base.y,
        });
      } else {
        const pos = resolveExpandedPos(
          source,
          base,
          i,
          sources.length,
          anchorHeight,
          imageScatter,
        );
        await db.nodes.update(source.id, pos);
      }
    }
  });
  return sources.length;
}

function searchMediaDescription(
  title: string,
  snippet: string | undefined,
  relationContext?: WebSearchRelationContext,
): string | undefined {
  const headline = title.replace(/\s+/g, ' ').trim();
  const relation =
    relationContext &&
    buildWebSearchMediaRelation({
      query: relationContext.query,
      parentLabel: relationContext.parentLabel,
      snippet,
    });
  if (headline && relation) return formatSearchMediaDescription(headline, relation);
  return headline || relation || undefined;
}

export function pageToMarkdown(wp: MetasoWebpage, index: number): string {
  const link = (wp.link || '').trim();
  const titleRaw = (wp.title || '').replace(/\n/g, ' ').trim();
  const title = titleRaw && titleRaw !== link ? titleRaw : hostFromUrl(link);
  const snippet = (wp.snippet || '').trim();
  const date = (wp.date || '').trim();
  const blocks = [`### ${index}. ${title}`];
  if (date) blocks.push(date);
  if (snippet && snippet !== link) blocks.push(snippet);
  return blocks.join('\n\n');
}

function hostFromUrl(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '') || 'Source';
  } catch {
    return 'Source';
  }
}

/**
 * Fill missing `previewImageUrl` on already-spawned webpage source cards
 * (e.g. Metaso hits after og:image fetch).
 */
export async function attachPreviewImagesToSourceCards(
  parentId: string,
  images: Array<{ link?: string; imageUrl?: string; thumbnail?: string }>,
): Promise<void> {
  const byPage = new Map<string, string>();
  for (const img of images) {
    const page = (img.link ?? '').trim().toLowerCase();
    const url = (img.imageUrl || img.thumbnail || '').trim();
    if (!page || !/^https?:\/\//i.test(url) || byPage.has(page)) continue;
    byPage.set(page, url);
  }
  if (byPage.size === 0) return;

  const cards = await db.nodes
    .filter(
      (n) =>
        n.webSearchParentId === parentId &&
        (n.type === 'text' || n.type === 'note') &&
        Boolean((n.sourceUrl || '').trim()),
    )
    .toArray();

  for (const card of cards) {
    if ((card.previewImageUrl || '').trim()) continue;
    const preview = byPage.get((card.sourceUrl || '').trim().toLowerCase());
    if (!preview) continue;
    await db.nodes.update(card.id, {
      previewImageUrl: preview,
      height: Math.max(
        card.height ?? SOURCE_CARD_HEIGHT,
        SOURCE_CARD_HEIGHT + SOURCE_CARD_PREVIEW_EXTRA,
      ),
    });
  }
}

/**
 * Create one compact, scrollable source card per hit in a vertical lane beside the source node.
 */
export async function spawnWebSearchCardsFromPages(
  sourceNodeId: string,
  base: { x: number; y: number },
  pages: MetasoWebpage[],
  activeCanvasId: string,
  options?: {
    staggerMs?: number;
    anchorHeight?: number;
    /** Offset into a shared vertical lane (e.g. after image cards). */
    indexOffset?: number;
    /** Total cards in the lane for vertical centering; defaults to this batch size + offset. */
    laneCount?: number;
  },
): Promise<void> {
  const staggerMs = options?.staggerMs ?? DEFAULT_STAGGER_MS;
  const anchorHeight = options?.anchorHeight ?? DEFAULT_ANCHOR_HEIGHT;
  const indexOffset = options?.indexOffset ?? 0;
  const list = pages.filter((p) => (p.title || p.snippet || p.link).trim().length > 0);
  const laneCount = options?.laneCount ?? indexOffset + list.length;

  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    const laneIndex = indexOffset + i;
    const id = crypto.randomUUID();
    const page = list[i]!;
    const preview = (page.imageUrl || '').trim();
    const hasPreview = /^https?:\/\//i.test(preview);
    await db.nodes.add(stampNewCard({
      id,
      canvasId: activeCanvasId,
      type: 'text',
      content: pageToMarkdown(page, laneIndex + 1),
      x: base.x + SOURCE_LANE_OFFSET_X,
      y: sourceCardY(base.y, laneIndex, laneCount, anchorHeight),
      width: SOURCE_CARD_WIDTH,
      height: hasPreview ? SOURCE_CARD_HEIGHT + SOURCE_CARD_PREVIEW_EXTRA : SOURCE_CARD_HEIGHT,
      layout: 2,
      sourceUrl: (page.link || '').trim() || undefined,
      previewImageUrl: hasPreview ? preview : undefined,
      webSearchParentId: sourceNodeId,
      webSearchIndex: laneIndex,
    }));
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      from: sourceNodeId,
      to: id,
    });
  }
}

/**
 * Create playable video/podcast cards for Metaso hits (vertical lane).
 * Uses in-card iframe / video / audio when the URL is embeddable; otherwise a fallback + source link.
 */
export async function spawnWebSearchCardsFromMedia(
  sourceNodeId: string,
  base: { x: number; y: number },
  items: MetasoMediaItem[],
  activeCanvasId: string,
  kind: 'video' | 'podcast',
  options?: {
    staggerMs?: number;
    anchorHeight?: number;
    indexOffset?: number;
    laneCount?: number;
    /** Why these hits sit beside the parent card (shown under the title). */
    relationContext?: WebSearchRelationContext;
  },
): Promise<void> {
  const staggerMs = options?.staggerMs ?? DEFAULT_STAGGER_MS;
  const anchorHeight = options?.anchorHeight ?? DEFAULT_ANCHOR_HEIGHT;
  const indexOffset = options?.indexOffset ?? 0;
  const list = items.filter((p) => (p.title || p.snippet || p.link || p.audioUrl || '').trim().length > 0);
  const laneCount = options?.laneCount ?? indexOffset + list.length;

  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    const laneIndex = indexOffset + i;
    const id = crypto.randomUUID();
    const item = list[i]!;
    const page = (item.link || item.audioUrl || '').trim();
    const playback = resolveMediaPlayback({
      kind,
      link: item.link,
      audioUrl: item.audioUrl,
    });
    const title = (item.title || (kind === 'video' ? 'Video' : 'Podcast')).replace(/\s+/g, ' ').trim();
    const meta = [kind === 'podcast' ? item.showName : undefined, item.authors, item.duration]
      .filter(Boolean)
      .join(' · ');
    const headline = meta ? `${title} · ${meta}` : title;
    await db.nodes.add(stampNewCard({
      id,
      canvasId: activeCanvasId,
      type: 'video',
      content: playback.mode === 'none' ? page : playback.src,
      description: searchMediaDescription(headline, item.snippet, options?.relationContext),
      sourceUrl: page || undefined,
      fileType: playback.mode === 'none' ? undefined : playback.mode,
      x: base.x + SOURCE_LANE_OFFSET_X,
      y: sourceCardY(base.y, laneIndex, laneCount, anchorHeight),
      width: SOURCE_CARD_WIDTH,
      height: SOURCE_CARD_HEIGHT,
      webSearchParentId: sourceNodeId,
      webSearchIndex: laneIndex,
    }));
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      from: sourceNodeId,
      to: id,
    });
  }
}

/**
 * Create image nodes from Metaso hits as a loose overlapping scatter beside the parent.
 */
export async function spawnWebSearchCardsFromImages(
  sourceNodeId: string,
  base: { x: number; y: number },
  images: MetasoImage[],
  activeCanvasId: string,
  options?: {
    staggerMs?: number;
    anchorHeight?: number;
    indexOffset?: number;
    laneCount?: number;
    /** Why these hits sit beside the parent card (shown under the title). */
    relationContext?: WebSearchRelationContext;
  },
): Promise<void> {
  const staggerMs = options?.staggerMs ?? DEFAULT_STAGGER_MS;
  const anchorHeight = options?.anchorHeight ?? DEFAULT_ANCHOR_HEIGHT;
  const indexOffset = options?.indexOffset ?? 0;
  const list = images
    .map((img) => {
      const url = resolveMetasoImageUrl(img);
      const page =
        typeof img.link === 'string' && /^https?:\/\//i.test(img.link.trim())
          ? img.link.trim()
          : '';
      // Prefer the host page; fall back to the image URL so the card always has a jump target.
      const sourceUrl = page && page !== url ? page : page || url;
      return {
        url,
        sourceUrl,
        title: (img.title || '').replace(/\s+/g, ' ').trim(),
      };
    })
    .filter((row) => row.url.length > 0);
  const scatterCount = options?.laneCount ?? indexOffset + list.length;

  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    const laneIndex = indexOffset + i;
    const row = list[i]!;
    const id = crypto.randomUUID();
    const pos = sourceImageScatterPos(base, laneIndex, scatterCount, anchorHeight);
    await db.nodes.add(stampNewCard({
      id,
      canvasId: activeCanvasId,
      type: 'image',
      content: row.url,
      description: searchMediaDescription(row.title, undefined, options?.relationContext),
      sourceUrl: row.sourceUrl || undefined,
      x: pos.x,
      y: pos.y,
      width: SOURCE_CARD_WIDTH,
      height: SOURCE_CARD_HEIGHT,
      webSearchParentId: sourceNodeId,
      webSearchIndex: laneIndex,
    }));
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      from: sourceNodeId,
      to: id,
    });
  }
}
