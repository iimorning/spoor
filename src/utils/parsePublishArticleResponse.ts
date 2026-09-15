import { parseLenientLlmJson } from './llmJson';

export interface ParsedPublishSegment {
  cardId: string;
  /** Verbatim source-card markdown. Fidelity gate (validateSourceCardFidelity) may overwrite. */
  cardText: string;
  /** AI-added bridge sentences. Inserted before this segment's cardText in the rendered body. */
  transitions: string[];
  /** Exact substrings of cardText the AI wants removed. Wrapped, never rewritten. */
  deletions: string[];
}

export interface ParsedPublishArticle {
  title: string;
  /** Interleaved body: transitions (wrapped in <mark data-ai-transition>) + cardText. */
  body: string;
  segments: ParsedPublishSegment[];
}

const MAX_TRANSITIONS_PER_GAP = 2;
const MAX_OPENER_TRANSITIONS = 1;
const MAX_DELETIONS_PER_CARD = 8;
const MAX_DELETION_CHARS = 400;
const TRANSITION_OPEN = '<mark data-ai-transition="true">';
const TRANSITION_CLOSE = '</mark>';
export const DELETION_OPEN = '<mark data-ai-deletion="true">';
export const DELETION_CLOSE = '</mark>';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Drop transition entries that aren't plain prose: headings, lists, code blocks,
 * or anything containing a Markdown link/image. The AI prompt forbids these inside
 * transitions; we defend at the parser layer so the editor never sees them.
 */
function sanitizeTransitions(raw: unknown, debugId: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const text = asString(item).trim();
    if (!text) continue;
    if (/^#{1,6}\s/.test(text)) {
      console.warn(`[parsePublishArticleResponse:${debugId}] dropped transition (heading):`, text);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s/.test(text)) {
      console.warn(`[parsePublishArticleResponse:${debugId}] dropped transition (list):`, text);
      continue;
    }
    if (/^```/.test(text)) {
      console.warn(`[parsePublishArticleResponse:${debugId}] dropped transition (code block):`, text);
      continue;
    }
    if (/!?\[[^\]]*\]\([^)]+\)/.test(text)) {
      console.warn(`[parsePublishArticleResponse:${debugId}] dropped transition (link/image):`, text);
      continue;
    }
    out.push(text);
  }
  return out;
}

/**
 * Exact substrings the model wants struck from source text. Must be copy-paste
 * fragments — no media markdown, no HTML, and not the whole card.
 */
function sanitizeDeletions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_DELETIONS_PER_CARD) break;
    const text = asString(item);
    if (!text || text.length > MAX_DELETION_CHARS) continue;
    if (/[<>&]/.test(text)) continue;
    if (/!?\[[^\]]*\]\([^)]+\)/.test(text)) continue;
    if (/media:\/\//i.test(text) || /spoor-article-media:/i.test(text)) continue;
    if (/^https?:\/\//i.test(text.trim())) continue;
    out.push(text);
  }
  return out;
}

/** Overlapping count: "aa" in "aaa" is 2. Ambiguous hits must not be deleted. */
export function countExactOccurrences(source: string, snippet: string): number {
  if (!source || !snippet) return 0;
  let count = 0;
  let from = 0;
  while (from <= source.length - snippet.length) {
    const idx = source.indexOf(snippet, from);
    if (idx < 0) break;
    count += 1;
    from = idx + 1;
  }
  return count;
}

/**
 * Keep deletions that occur exactly once, character-for-character, in `source`.
 * Missing, whole-card, or repeated substrings are dropped — prefer no delete over a wrong delete.
 */
export function filterSafeDeletions(source: string, deletions: readonly string[]): string[] {
  if (!source || !deletions?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const snippet of deletions) {
    if (!snippet || snippet.length > MAX_DELETION_CHARS) continue;
    if (seen.has(snippet)) continue;
    if (snippet.trim() === source.trim()) continue;
    if (countExactOccurrences(source, snippet) !== 1) continue;
    seen.add(snippet);
    out.push(snippet);
    if (out.length >= MAX_DELETIONS_PER_CARD) break;
  }
  return out;
}

/** Wrap the unique occurrence of each safe deletion in source markdown. */
export function wrapDeletionsInSource(source: string, deletions: string[]): string {
  if (!source || !Array.isArray(deletions) || deletions.length === 0) return source;
  const safe = filterSafeDeletions(source, deletions);
  const spans: Array<{ start: number; end: number }> = [];
  for (const snippet of safe) {
    const idx = source.indexOf(snippet);
    if (idx < 0) continue;
    const end = idx + snippet.length;
    const overlaps = spans.some((s) => idx < s.end && end > s.start);
    if (overlaps) continue;
    spans.push({ start: idx, end });
  }
  spans.sort((a, b) => b.start - a.start);
  let out = source;
  for (const span of spans) {
    out =
      out.slice(0, span.start) +
      DELETION_OPEN +
      out.slice(span.start, span.end) +
      DELETION_CLOSE +
      out.slice(span.end);
  }
  return out;
}

function normalizeForCompare(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Enforce the "do not rewrite card text" contract. For each segment whose cardId maps
 * to a source card, whitespace-normalize compare `segment.cardText` against the source
 * card's markdown. On mismatch, overwrite `cardText` with the source verbatim.
 *
 * Strict by design: see feature plan. Soft warnings let drift accumulate.
 *
 * Returns the number of segments that had to be overridden (for telemetry / UI).
 */
export function validateSourceCardFidelity(
  segments: ParsedPublishSegment[],
  sourceCards: Array<{ nodeId: string; markdown: string }>,
): number {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  const byId = new Map<string, string>();
  for (const sc of sourceCards ?? []) byId.set(sc.nodeId, sc.markdown ?? '');
  let overrides = 0;
  for (const seg of segments) {
    if (!seg.cardId) continue;
    const source = byId.get(seg.cardId);
    if (typeof source !== 'string') continue;
    // Empty / data-URL / media-placeholder "source" is not real card text —
    // overwriting would wipe captions or leave Base64 / media:// blobs in the essay.
    if (!source.trim() || /^data:/i.test(source.trim()) || /media:\/\//i.test(source)) continue;
    if (normalizeForCompare(seg.cardText) !== normalizeForCompare(source)) {
      seg.cardText = source;
      overrides++;
    }
  }
  return overrides;
}

/**
 * Render order: transitions[0] (opener, max 1) + cardText[0] + transitions[1] (max 2) + cardText[1] + ... + cardText[N-1].
 * transitions[N-1] is dropped — there is no gap after the last card.
 *
 * Each transition is wrapped in <mark data-ai-transition="true"> so the essay editor's
 * AiTransitionMark picks it up on load (see src/components/essay/AiTransitionMark.ts).
 */
export function assemblePublishBody(
  parts: Array<{ text: string; transitions: string[]; deletions?: string[] }>,
): string {
  if (!Array.isArray(parts) || parts.length === 0) return '';
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const cap = i === 0 ? MAX_OPENER_TRANSITIONS : MAX_TRANSITIONS_PER_GAP;
    const transitions = (parts[i].transitions ?? []).slice(0, cap);
    for (const t of transitions) {
      out.push(`${TRANSITION_OPEN}${t}${TRANSITION_CLOSE}`);
    }
    out.push(wrapDeletionsInSource(parts[i].text ?? '', parts[i].deletions ?? []));
  }
  return out.filter((p) => p && p.trim()).join('\n\n');
}

/** Pull finished `"cardText"` / `"text"` JSON strings from a truncated LLM stream. */
export function previewStreamingPublishBody(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const texts: string[] = [];
  const re = /"(?:cardText|text)"\s*:\s*"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed))) {
    let i = match.index + match[0].length;
    let out = '';
    let escape = false;
    let closed = false;
    for (; i < trimmed.length; i++) {
      const c = trimmed[i]!;
      if (escape) {
        if (c === 'n') out += '\n';
        else if (c === 't') out += '\t';
        else if (c === 'r') out += '\r';
        else out += c;
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        closed = true;
        break;
      }
      out += c;
    }
    if (closed && out.trim()) texts.push(out);
  }
  return texts.join('\n\n').trim();
}

export function parsePublishArticleResponse(raw: string, fallbackTitle: string): ParsedPublishArticle {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { title: fallbackTitle, body: '', segments: [] };

  try {
    const data = parseLenientLlmJson(trimmed) as {
      title?: unknown;
      body?: unknown;
      segments?: unknown;
    };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const title = typeof data.title === 'string' ? data.title.trim() : '';

      const segmentsRaw = Array.isArray(data.segments) ? data.segments : null;
      if (segmentsRaw) {
        const segments: ParsedPublishSegment[] = [];
        for (const seg of segmentsRaw) {
          if (!seg || typeof seg !== 'object' || Array.isArray(seg)) continue;
          const s = seg as {
            cardId?: unknown;
            cardText?: unknown;
            /** Legacy: pre-feature models emitted {cardId, text} with text as the full AI rewrite. */
            text?: unknown;
            transitions?: unknown;
            deletions?: unknown;
          };
          const cardId = asString(s.cardId).trim();
          const cardText = asString(s.cardText).trim() || asString(s.text).trim();
          const transitions = sanitizeTransitions(s.transitions, cardId || '<orphan>');
          const deletions = sanitizeDeletions(s.deletions);
          if (!cardId && !cardText && transitions.length === 0 && deletions.length === 0) continue;
          segments.push({ cardId, cardText, transitions, deletions });
        }
        if (segments.length > 0) {
          const body = assemblePublishBody(
            segments.map((s) => ({
              text: s.cardText,
              transitions: s.transitions,
              deletions: s.deletions,
            })),
          );
          return { title: title || fallbackTitle, body, segments };
        }
      }

      // Legacy {title, body} format — no segments, no transitions. Pass body through.
      const body = asString(data.body).trim();
      if (title && body) {
        return { title, body, segments: [{ cardId: '', cardText: body, transitions: [], deletions: [] }] };
      }
      if (body) {
        return {
          title: title || fallbackTitle,
          body,
          segments: [{ cardId: '', cardText: body, transitions: [], deletions: [] }],
        };
      }
    }
  } catch {
    /* not JSON: fall through to markdown heading fallback */
  }

  const lines = trimmed.split('\n');
  const h1Idx = lines.findIndex((l) => /^#(?!#)\s+/.test(l.trim()));
  if (h1Idx >= 0) {
    const title = lines[h1Idx].trim().replace(/^#+\s+/, '').trim();
    const body = [...lines.slice(0, h1Idx), ...lines.slice(h1Idx + 1)].join('\n').trim();
    return {
      title: title || fallbackTitle,
      body: body || trimmed,
      segments: [{ cardId: '', cardText: body || trimmed, transitions: [], deletions: [] }],
    };
  }

  return {
    title: fallbackTitle,
    body: trimmed,
    segments: [{ cardId: '', cardText: trimmed, transitions: [], deletions: [] }],
  };
}
