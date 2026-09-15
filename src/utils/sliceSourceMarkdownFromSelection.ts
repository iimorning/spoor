import { compactTtsIndexMap, compactTtsText } from './ttsFollowAlongDom';

function lineStart(source: string, index: number): number {
  let i = index;
  while (i > 0 && source[i - 1] !== '\n') i -= 1;
  return i;
}

function lineEnd(source: string, index: number): number {
  let i = index;
  while (i < source.length && source[i] !== '\n') i += 1;
  return i;
}

function lineTextAt(source: string, index: number): string {
  const start = lineStart(source, index);
  return source.slice(start, lineEnd(source, start));
}

function isMarkdownTableLine(line: string): boolean {
  const t = line.trim();
  return t.includes('|');
}

/** Grow a source slice to full lines, and to the whole GFM table if it overlaps one. */
export function expandMarkdownSlice(source: string, start: number, end: number): string {
  let s = lineStart(source, start);
  let e = lineEnd(source, Math.max(start, end - 1));

  const overlapsTable = () => {
    let i = s;
    while (i < e) {
      if (isMarkdownTableLine(lineTextAt(source, i))) return true;
      i = lineEnd(source, i) + 1;
    }
    return isMarkdownTableLine(lineTextAt(source, Math.max(s, e - 1)));
  };

  if (overlapsTable()) {
    while (s > 0) {
      const prev = lineStart(source, s - 1);
      if (!isMarkdownTableLine(lineTextAt(source, prev))) break;
      s = prev;
    }
    while (e < source.length) {
      const next = e + (source[e] === '\n' ? 1 : 0);
      if (next >= source.length) break;
      if (!isMarkdownTableLine(lineTextAt(source, next))) break;
      e = lineEnd(source, next);
    }
  }

  return source.slice(s, e);
}

/**
 * Map rendered selection text back onto the original markdown so tables/headings
 * keep `|` / `#` instead of collapsing into a single prose line.
 */
export function sliceSourceMarkdownFromSelection(
  sourceMarkdown: string,
  selectedVisibleText: string,
): string | null {
  const needle = compactTtsText(selectedVisibleText);
  if (needle.length < 2) return null;
  const { compact, map } = compactTtsIndexMap(sourceMarkdown);
  const idx = compact.indexOf(needle);
  if (idx < 0) return null;
  const start = map[idx];
  const last = map[idx + needle.length - 1];
  if (start == null || last == null) return null;
  return expandMarkdownSlice(sourceMarkdown, start, last + 1).replace(/\s+$/u, '').trimStart();
}

/** Keep markdown structure (tables, headings) when extracting; flatten plain prose. */
export function normalizeExtractedPassage(quote: string): string {
  const trimmed = quote.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return '';
  if (/[|\n]/.test(trimmed)) return trimmed;
  return trimmed.replace(/\s+/g, ' ').trim();
}
