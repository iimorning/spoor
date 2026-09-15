export type AskSearchHitKind = 'webpage' | 'image' | 'video' | 'podcast';

export type AskSearchHit = {
  kind: AskSearchHitKind;
  query: string;
  title: string;
  snippet: string;
  link?: string;
  /** Preview thumb (Wikipedia / Metaso image / og:image). */
  imageUrl?: string;
  date?: string;
};

export const ASK_SEARCH_SYNTHESIS_MAX_HITS = 10;
export const ASK_SEARCH_CHAT_MAX_HITS = 24;
export const ASK_SEARCH_SNIPPET_MAX = 240;

function hitKey(hit: AskSearchHit): string {
  return `${hit.kind}|${(hit.link || hit.title || hit.snippet).trim().toLowerCase()}`;
}

function dedupeHits(hits: AskSearchHit[], cap: number): AskSearchHit[] {
  const out: AskSearchHit[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = hitKey(hit);
    if (!key || key === `${hit.kind}|`) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= cap) break;
  }
  return out;
}

export function dedupeAskSearchHits(hits: AskSearchHit[]): AskSearchHit[] {
  return dedupeHits(hits, ASK_SEARCH_SYNTHESIS_MAX_HITS);
}

/** Persist / display cap — higher than the synthesis catalog. */
export function mergeAskSearchHits(
  existing: AskSearchHit[],
  incoming: AskSearchHit[],
  cap = ASK_SEARCH_CHAT_MAX_HITS,
): AskSearchHit[] {
  return dedupeHits([...existing, ...incoming], cap);
}

export function isChatVisibleSearchHit(hit: AskSearchHit): boolean {
  if (hit.title.trim() === 'Live search brief') return false;
  return Boolean(hit.title.trim() || hit.link?.trim() || hit.imageUrl?.trim());
}

export function searchHitHostname(link?: string): string {
  const raw = (link ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** Markdown inserted into the long-form editor from a chat search hit. */
export function formatSearchHitEssayMarkdown(hit: AskSearchHit): string {
  if (hit.kind === 'image' && hit.imageUrl?.trim()) {
    const title = (hit.title || '').replace(/\n/g, ' ').trim() || 'image';
    const link = (hit.link || '').trim();
    const image = `![${title}](${hit.imageUrl.trim()})`;
    return link && link !== hit.imageUrl.trim() ? `${image}\n\n[${title}](${link})` : image;
  }
  const body = formatSearchHitCanvasMarkdown(hit);
  const link = (hit.link || '').trim();
  return link ? `${body}\n\n${link}` : body;
}

/** Markdown body for a webpage (or similar) hit placed on the canvas. */
export function formatSearchHitCanvasMarkdown(hit: AskSearchHit): string {
  const link = (hit.link || '').trim();
  const titleRaw = (hit.title || '').replace(/\n/g, ' ').trim();
  const title =
    titleRaw && titleRaw !== link ? titleRaw : searchHitHostname(link) || titleRaw || 'Source';
  const snippet = (hit.snippet || '').trim();
  const date = (hit.date || '').trim();
  const blocks = [`### ${title}`];
  if (date) blocks.push(date);
  if (snippet && snippet !== link) blocks.push(snippet);
  return blocks.join('\n\n');
}

export function hitsEligibleForAskSynthesis(hits: AskSearchHit[]): boolean {
  return hits.some((h) => {
    if (h.kind === 'webpage' || h.kind === 'video' || h.kind === 'podcast') {
      return (
        h.snippet.trim().length > 0 ||
        (h.title.trim().length > 0 && Boolean(h.link?.trim()))
      );
    }
    if (h.kind === 'image') {
      return (
        h.title.trim().length > 0 &&
        Boolean(h.link?.trim() || h.imageUrl?.trim())
      );
    }
    return false;
  });
}

export function formatAskSearchHitsForModel(hits: AskSearchHit[]): string {
  const rows = dedupeAskSearchHits(hits);
  if (rows.length === 0) return '';
  return rows
    .map((h, i) => {
      const snipCap = h.link?.trim() ? ASK_SEARCH_SNIPPET_MAX : 1600;
      const snip = h.snippet.replace(/\s+/g, ' ').trim().slice(0, snipCap);
      const title = h.title.replace(/\s+/g, ' ').trim() || '(untitled)';
      const link = h.link?.trim();
      const meta = [h.kind, h.query ? `query: ${h.query}` : ''].filter(Boolean).join(' · ');
      return [
        `[${i + 1}] (${meta}) ${title}`,
        snip ? `    ${snip}` : '',
        link ? `    ${link}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}
