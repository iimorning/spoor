export type OpenRouterSearchHit = {
  title: string;
  link: string;
  snippet: string;
  date?: string;
};

function asHttpUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function hostLabel(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}

function asDate(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 32);
}

function pushHit(
  out: OpenRouterSearchHit[],
  seen: Set<string>,
  title: string,
  url: unknown,
  snippet: string,
  date = '',
) {
  const link = asHttpUrl(url);
  if (!link || seen.has(link)) return;
  seen.add(link);
  const label = title.replace(/\s+/g, ' ').trim() || hostLabel(link);
  const hit: OpenRouterSearchHit = {
    title: label,
    link,
    snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 600),
  };
  if (date) hit.date = date;
  out.push(hit);
}

function considerCitation(out: OpenRouterSearchHit[], seen: Set<string>, raw: unknown) {
  if (typeof raw === 'string') {
    pushHit(out, seen, '', raw, '');
    return;
  }
  if (!raw || typeof raw !== 'object') return;
  const o = raw as Record<string, unknown>;
  const inner =
    o.url_citation && typeof o.url_citation === 'object'
      ? (o.url_citation as Record<string, unknown>)
      : o;
  pushHit(
    out,
    seen,
    String(inner.title ?? inner.name ?? ''),
    inner.url ?? inner.link ?? inner.uri,
    String(inner.content ?? inner.snippet ?? inner.text ?? inner.excerpt ?? ''),
    asDate(inner.date ?? inner.last_updated ?? inner.published_at),
  );
}

/**
 * Official lists only: Perplexity `search_results`, then OpenRouter annotations,
 * then citation URL strings. Never scrape the assistant essay (markdown links
 * there are often unrelated, e.g. W3C CSP).
 */
export function parseOpenRouterSearchHits(data: unknown): OpenRouterSearchHit[] {
  const out: OpenRouterSearchHit[] = [];
  const seen = new Set<string>();
  if (!data || typeof data !== 'object') return out;
  const root = data as Record<string, unknown>;
  const message = Array.isArray(root.choices)
    ? ((root.choices[0] as { message?: Record<string, unknown> } | undefined)?.message ?? undefined)
    : undefined;

  if (Array.isArray(root.search_results) && root.search_results.length > 0) {
    for (const row of root.search_results) considerCitation(out, seen, row);
    return out;
  }
  if (Array.isArray(root.webpages) && root.webpages.length > 0) {
    for (const row of root.webpages) considerCitation(out, seen, row);
    return out;
  }
  if (message && Array.isArray(message.annotations)) {
    for (const row of message.annotations) considerCitation(out, seen, row);
  }
  if (Array.isArray(root.annotations)) {
    for (const row of root.annotations) considerCitation(out, seen, row);
  }
  if (out.length > 0) return out;
  if (message && Array.isArray(message.citations)) {
    for (const row of message.citations) considerCitation(out, seen, row);
  }
  if (Array.isArray(root.citations)) {
    for (const row of root.citations) considerCitation(out, seen, row);
  }
  return out;
}
