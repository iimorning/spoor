import type { CanvasNode, Edge } from '../db';
import { imageHrefToDataUrl } from './aiGeneratedImage';
import { parseSearchMediaDescription } from './webSearchMediaCaption';

const LOG_PREFIX = '[Scribe AI]';

/** Reference stills sent to GPT-Image-2 (`input_references`). */
export const MAX_DRAW_REFERENCE_IMAGES = 4;

/** Skip data URLs longer than this (~9MB raw upper bound for base64 payload). */
export const MAX_DATA_URL_CHARS = 12_000_000;

/** Longest side when shrinking local images for chat vision (pixels). */
export const LLM_VISION_MAX_EDGE = 1280;

/** Skip re-encoding when the data URL is already small enough for text-token billing. */
export const LLM_VISION_COMPACT_MIN_CHARS = 80_000;

/** Drop a local image part if it is still this large after compacting. */
export const MAX_VISION_DATA_URL_CHARS = 400_000;

export function isImageDataUrl(s: string): boolean {
  return s.startsWith('data:image/') && s.includes('base64,');
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** Vite-bundled canvas assets resolve to same-origin root paths. */
function isSameOriginAssetPath(s: string): boolean {
  return s.startsWith('/') && !s.startsWith('//');
}

/** Canvas image `content` that can be shown to the model (inline data URL or remote http). */
export function isAttachableImageContent(s: string): boolean {
  const c = s.trim();
  if (!c) return false;
  if (isImageDataUrl(c)) return true;
  if (isHttpUrl(c)) return true;
  return isSameOriginAssetPath(c);
}

/** Caption under an image card (search title or user label), never the pixel payload. */
export function imageCardAskCaption(node: Pick<CanvasNode, 'description'>): string {
  return parseSearchMediaDescription(node.description).title;
}

export const IMAGE_SOURCE_NOTE_MAX = 900;

export function clipImageSourceNote(text: string, max = IMAGE_SOURCE_NOTE_MAX): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}

/** Directly linked AI card prose — fallback when the image was generated before we persisted `imageSourceNote`. */
export function linkedImageSourceNote(
  imageId: string,
  nodes: CanvasNode[],
  edges: Array<{ from: string; to: string }>,
): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const other = e.from === imageId ? e.to : e.to === imageId ? e.from : '';
    if (!other) continue;
    const n = byId.get(other);
    if (n?.type !== 'ai') continue;
    const body = [(n.userTurn ?? '').trim(), (n.content ?? '').trim()].filter(Boolean).join('\n');
    const clipped = clipImageSourceNote(body);
    if (clipped) return clipped;
  }
  return '';
}

/** Resolve current image hrefs for persisted thread image ids (order preserved; missing nodes skipped). */
export function resolveImageDataUrlsFromNodeIds(
  nodeIds: string[] | undefined,
  nodes: CanvasNode[],
): string[] {
  if (!nodeIds?.length) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dataUrls: string[] = [];
  for (const id of nodeIds) {
    const n = byId.get(id);
    if (!n || n.type !== 'image') continue;
    const c = (n.content ?? '').trim();
    if (!isAttachableImageContent(c)) continue;
    if (isImageDataUrl(c) && c.length > MAX_DATA_URL_CHARS) {
      console.warn(`${LOG_PREFIX} skip oversized image node ${id} (${c.length} chars)`);
      continue;
    }
    dataUrls.push(c);
  }
  return dataUrls;
}

function considerDrawReferenceImage(
  id: string,
  byId: Map<string, CanvasNode>,
  seen: Set<string>,
  exclude: Set<string>,
  orderedIds: string[],
): void {
  if (seen.has(id) || exclude.has(id)) return;
  const n = byId.get(id);
  if (!n || n.type !== 'image') return;
  if (n.imageStatus === 'generating' || n.imageStatus === 'error') return;
  const c = (n.content ?? '').trim();
  if (!isAttachableImageContent(c)) return;
  if (isImageDataUrl(c) && c.length > MAX_DATA_URL_CHARS) {
    console.warn(`${LOG_PREFIX} skip oversized draw reference ${id} (${c.length} chars)`);
    return;
  }
  seen.add(id);
  orderedIds.push(id);
}

function collectNeighborImageIds(
  anchorId: string,
  edges: Array<{ from: string; to: string }>,
  byId: Map<string, CanvasNode>,
  seen: Set<string>,
  exclude: Set<string>,
  orderedIds: string[],
): void {
  for (const e of edges) {
    const other = e.from === anchorId ? e.to : e.to === anchorId ? e.from : '';
    if (other) considerDrawReferenceImage(other, byId, seen, exclude, orderedIds);
  }
}

/**
 * Canvas stills to send to GPT-Image-2 as `input_references`.
 * Prefers this turn's extra image ids (work-zone / chat payload), then
 * `threadContextImageNodeIds`, then 1-hop image neighbors.
 * Ghosts / failed cards are skipped.
 */
export function collectDrawReferenceImageContents(
  anchor: Pick<CanvasNode, 'id' | 'type' | 'threadContextImageNodeIds'>,
  nodes: CanvasNode[],
  edges: Array<{ from: string; to: string }>,
  excludeIds: Iterable<string> = [],
  extraImageNodeIds: Iterable<string> = [],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const exclude = new Set(excludeIds);
  exclude.add(anchor.id);
  const seen = new Set<string>();
  const orderedIds: string[] = [];

  for (const id of extraImageNodeIds) {
    considerDrawReferenceImage(id, byId, seen, exclude, orderedIds);
  }

  const pullFrom = (node: Pick<CanvasNode, 'id' | 'threadContextImageNodeIds'> | undefined) => {
    if (!node) return;
    for (const id of node.threadContextImageNodeIds ?? []) {
      considerDrawReferenceImage(id, byId, seen, exclude, orderedIds);
    }
    collectNeighborImageIds(node.id, edges, byId, seen, exclude, orderedIds);
  };

  pullFrom(anchor);
  if (anchor.type === 'image') {
    for (const e of edges) {
      const other = e.from === anchor.id ? e.to : e.to === anchor.id ? e.from : '';
      const n = other ? byId.get(other) : undefined;
      if (n && (n.type === 'ai' || n.type === 'ask' || n.type === 'hub')) pullFrom(n);
    }
  }

  return orderedIds
    .slice(0, MAX_DRAW_REFERENCE_IMAGES)
    .map((id) => (byId.get(id)?.content ?? '').trim())
    .filter(Boolean);
}

/**
 * Turn collected canvas image hrefs into data URLs the chat APIs accept.
 * Remote http(s) images are fetched (via the same-origin CDN proxy when needed).
 */
export async function materializeImageDataUrls(contents: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of contents) {
    const s = raw.trim();
    if (!s) continue;
    try {
      const dataUrl = isImageDataUrl(s) ? s : await imageHrefToDataUrl(s);
      if (!isImageDataUrl(dataUrl)) continue;
      if (dataUrl.length > MAX_DATA_URL_CHARS) {
        console.warn(`${LOG_PREFIX} skip oversized materialized image (${dataUrl.length} chars)`);
        continue;
      }
      out.push(dataUrl);
    } catch (err) {
      console.warn(`${LOG_PREFIX} skip image that could not be loaded`, err);
    }
  }
  return out;
}

/**
 * Images for Chat Completions `image_url` parts.
 * Keep http(s) as URLs so the provider fetches pixels (not millions of text tokens).
 * Compact local data URLs so Base64 is not billed as a giant text prompt.
 */
/**
 * One slot per input href (same order). `null` means the pixels were not
 * attached, so outline `Attached visual #N` numbering must be remapped.
 */
export async function prepareLlmVisionImageSlots(
  contents: string[],
): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  for (const raw of contents) {
    const s = raw.trim();
    if (!s) {
      out.push(null);
      continue;
    }
    if (isHttpUrl(s)) {
      out.push(s);
      continue;
    }
    try {
      const dataUrl = isImageDataUrl(s) ? s : await imageHrefToDataUrl(s);
      if (!isImageDataUrl(dataUrl)) {
        out.push(null);
        continue;
      }
      if (dataUrl.length > MAX_DATA_URL_CHARS) {
        console.warn(`${LOG_PREFIX} skip oversized vision image (${dataUrl.length} chars)`);
        out.push(null);
        continue;
      }
      const compact = await compactVisionDataUrl(dataUrl);
      if (compact.length > MAX_VISION_DATA_URL_CHARS) {
        console.warn(`${LOG_PREFIX} skip still-huge vision image (${compact.length} chars)`);
        out.push(null);
        continue;
      }
      out.push(compact);
    } catch (err) {
      console.warn(`${LOG_PREFIX} skip image that could not be loaded`, err);
      out.push(null);
    }
  }
  return out;
}

export async function prepareLlmVisionImages(contents: string[]): Promise<string[]> {
  return (await prepareLlmVisionImageSlots(contents)).filter((url): url is string => url != null);
}

async function compactVisionDataUrl(dataUrl: string): Promise<string> {
  if (dataUrl.length <= LLM_VISION_COMPACT_MIN_CHARS) return dataUrl;
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return dataUrl;
  }
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, LLM_VISION_MAX_EDGE / Math.max(bitmap.width, bitmap.height, 1));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return dataUrl;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const jpeg = canvas.toDataURL('image/jpeg', 0.72);
    return jpeg.startsWith('data:image/jpeg') && jpeg.length < dataUrl.length ? jpeg : dataUrl;
  } catch (err) {
    console.warn(`${LOG_PREFIX} vision image compact failed`, err);
    return dataUrl;
  }
}
