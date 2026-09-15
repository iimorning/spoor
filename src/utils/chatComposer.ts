import type { CanvasNode } from '../db';
import { imageCardAskCaption } from './canvasContextImages';
import { getCanvasNodeContextText } from './canvasNodeContextText';

export type ComposerSegment =
  | { type: 'card'; nodeId: string }
  | { type: 'text'; content: string };

export const EMPTY_COMPOSER: ComposerSegment[] = [{ type: 'text', content: '' }];

export function normalizeComposerSegments(segments: ComposerSegment[] | undefined): ComposerSegment[] {
  if (!segments?.length) return [...EMPTY_COMPOSER];
  const collapsed: ComposerSegment[] = [];
  for (const segment of segments) {
    if (segment.type === 'text') {
      const content = segment.content ?? '';
      const last = collapsed.at(-1);
      if (last?.type === 'text') {
        last.content += content;
      } else {
        collapsed.push({ type: 'text', content });
      }
    } else {
      collapsed.push({ type: 'card', nodeId: segment.nodeId });
    }
  }
  if (collapsed.at(-1)?.type !== 'text') collapsed.push({ type: 'text', content: '' });
  return collapsed.length > 0 ? collapsed : [...EMPTY_COMPOSER];
}

export function focusNodeIdsFromSegments(segments: ComposerSegment[]): string[] {
  return segments.filter((s): s is Extract<ComposerSegment, { type: 'card' }> => s.type === 'card').map((s) => s.nodeId);
}

export function userTextFromSegments(segments: ComposerSegment[]): string {
  return segments
    .filter((s): s is Extract<ComposerSegment, { type: 'text' }> => s.type === 'text')
    .map((s) => s.content.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function composerHasContent(segments: ComposerSegment[]): boolean {
  const normalized = normalizeComposerSegments(segments);
  if (focusNodeIdsFromSegments(normalized).length > 0) return true;
  return userTextFromSegments(normalized).length > 0;
}

export type ReadCardBody = (nodeId: string) => string;

export function readCardBodyForPrompt(
  node: CanvasNode,
  readBody: ReadCardBody,
): string {
  if (node.type === 'image') {
    const caption = imageCardAskCaption(node) || (node.description ?? '').trim();
    const prompt = (node.imagePrompt ?? '').trim();
    const rationale = (node.imageSourceNote ?? '').trim();
    const parts = [caption, prompt ? `Prompt: ${prompt}` : '', rationale ? `Note: ${rationale}` : ''].filter(Boolean);
    return parts.join('\n').trim() || caption || '—';
  }
  const fromDom = readBody(node.id);
  if (fromDom) return fromDom;
  const ut = (node.userTurn ?? '').trim();
  const body = (node.content ?? '').trim();
  return [ut, body].filter(Boolean).join('\n\n').trim();
}

export function serializeComposerSegments(
  segments: ComposerSegment[],
  nodes: CanvasNode[],
  readBody: ReadCardBody,
): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cardIndex = 0;
  const parts: string[] = [];

  for (const segment of normalizeComposerSegments(segments)) {
    if (segment.type === 'text') {
      const text = segment.content.trim();
      if (text) parts.push(text);
      continue;
    }
    const node = byId.get(segment.nodeId);
    if (!node) continue;
    cardIndex += 1;
    const body = readCardBodyForPrompt(node, readBody);
    parts.push(`[${cardIndex}] ${body}`);
  }

  return parts.join('\n\n').trim();
}

/** Collapse [n] material blocks in stored user messages for sidebar display. */
export function formatUserMessageForDisplay(text: string): string {
  const trimmed = text.trim();
  if (!/^\[\d+\]\s/m.test(trimmed)) return trimmed;
  const blocks = trimmed.split(/\n\n+/);
  const out: string[] = [];
  for (const block of blocks) {
    const m = block.match(/^\[(\d+)\]\s+([\s\S]*)$/);
    if (m) {
      const preview = m[2]!.replace(/\s+/g, ' ').trim();
      const short = preview.length > 48 ? `${preview.slice(0, 47)}…` : preview;
      out.push(`[${m[1]}] ${short || '…'}`);
    } else {
      out.push(block);
    }
  }
  return out.join('\n\n');
}

export function mergeSelectionIntoComposer(
  segments: ComposerSegment[],
  selectedIds: string[],
  _prevSelectedIds: string[],
): ComposerSegment[] {
  const next = normalizeComposerSegments(segments);
  const selected = new Set(selectedIds);

  const filtered = next.filter((s) => s.type !== 'card' || selected.has(s.nodeId));
  // Re-insert any selected card missing from composer. `prev` only preserves
  // order of cards already present — it must not skip a card after composer
  // was reset (draft hydrate / persist) while the canvas selection remained.
  const newIds = selectedIds.filter(
    (id) => !filtered.some((s) => s.type === 'card' && s.nodeId === id),
  );

  // The trailing empty text segment is the insertion point. Put newly selected
  // cards before it, then restore one empty input after the cards.
  if (
    newIds.length > 0 &&
    filtered.at(-1)?.type === 'text' &&
    !(filtered.at(-1) as Extract<ComposerSegment, { type: 'text' }>).content
  ) {
    filtered.pop();
  }
  for (const id of newIds) {
    filtered.push({ type: 'card', nodeId: id });
  }

  if (filtered.at(-1)?.type !== 'text') {
    filtered.push({ type: 'text', content: '' });
  }

  return normalizeComposerSegments(filtered);
}

export function removeCardFromComposer(segments: ComposerSegment[], nodeId: string): ComposerSegment[] {
  const filtered = normalizeComposerSegments(segments).filter(
    (s) => !(s.type === 'card' && s.nodeId === nodeId),
  );
  return normalizeComposerSegments(filtered);
}

export function resolveReorderIndex(
  fromIndex: number,
  dropIndex: number,
  place: 'before' | 'after',
): number {
  if (place === 'before') return fromIndex < dropIndex ? dropIndex - 1 : dropIndex;
  return fromIndex <= dropIndex ? dropIndex : dropIndex + 1;
}

export function insertCardAtTextOffset(
  segments: ComposerSegment[],
  cardFromIndex: number,
  textIndex: number,
  offset: number,
): ComposerSegment[] {
  const next = normalizeComposerSegments(segments);
  const card = next[cardFromIndex];
  const textSeg = next[textIndex];
  if (card?.type !== 'card' || textSeg?.type !== 'text') return next;
  const text = textSeg.content;
  const clamped = Math.max(0, Math.min(offset, text.length));
  if (clamped === 0) {
    return reorderComposerSegment(
      next,
      cardFromIndex,
      resolveReorderIndex(cardFromIndex, textIndex, 'before'),
    );
  }
  if (clamped >= text.length) {
    return reorderComposerSegment(
      next,
      cardFromIndex,
      resolveReorderIndex(cardFromIndex, textIndex, 'after'),
    );
  }
  next.splice(cardFromIndex, 1);
  const idx = cardFromIndex < textIndex ? textIndex - 1 : textIndex;
  next.splice(
    idx,
    1,
    { type: 'text', content: text.slice(0, clamped) },
    card,
    { type: 'text', content: text.slice(clamped) },
  );
  if (next.at(-1)?.type !== 'text') next.push({ type: 'text', content: '' });
  return normalizeComposerSegments(next);
}

export function reorderComposerSegment(
  segments: ComposerSegment[],
  fromIndex: number,
  toIndex: number,
): ComposerSegment[] {
  const next = normalizeComposerSegments(segments);
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length) return next;
  if (fromIndex === toIndex) return next;
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item!);
  return normalizeComposerSegments(next);
}

export function updateTextSegment(
  segments: ComposerSegment[],
  index: number,
  content: string,
): ComposerSegment[] {
  const next = normalizeComposerSegments(segments);
  if (index < 0 || index >= next.length || next[index]?.type !== 'text') return next;
  next[index] = { type: 'text', content };
  return next;
}

export function segmentsFromFocusAndText(
  focusNodeIds: string[],
  text: string,
): ComposerSegment[] {
  const segments: ComposerSegment[] = [];
  for (const nodeId of focusNodeIds) {
    segments.push({ type: 'card', nodeId });
  }
  segments.push({ type: 'text', content: text });
  return segments.length > 0 ? segments : [...EMPTY_COMPOSER];
}

export function collectFocusImageDataUrls(
  segments: ComposerSegment[],
  nodes: CanvasNode[],
): { nodeIds: string[]; dataUrls: string[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeIds: string[] = [];
  const dataUrls: string[] = [];
  for (const segment of segments) {
    if (segment.type !== 'card') continue;
    const node = byId.get(segment.nodeId);
    if (!node || node.type !== 'image') continue;
    const href = (node.content ?? '').trim();
    if (!href) continue;
    nodeIds.push(node.id);
    dataUrls.push(href);
  }
  return { nodeIds, dataUrls };
}

export function readCardBodyFromRefs(
  nodeId: string,
  nodes: CanvasNode[],
  nodesRef?: Record<string, HTMLElement | null>,
): string {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return '';
  const readBody = (id: string) => {
    const el = nodesRef?.[id];
    if (el) return getCanvasNodeContextText(el);
    const n = nodes.find((x) => x.id === id);
    return (n?.content ?? '').trim();
  };
  return readCardBodyForPrompt(node, readBody);
}
