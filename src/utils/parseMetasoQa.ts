import { parseOpenRouterSearchHits } from './parseOpenRouterSearchHits';
import type { MetasoSearchResponse, MetasoWebpage } from '../services/search';

function asText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return '';
}

function assistantText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const root = data as Record<string, unknown>;
  const choice = Array.isArray(root.choices)
    ? (root.choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined)
    : undefined;
  const fromChoice =
    asText(choice?.message?.content) ||
    asText(choice?.text) ||
    (typeof choice?.message?.content === 'object' && choice.message.content
      ? asText((choice.message.content as { text?: unknown }).text)
      : '');
  return (
    fromChoice ||
    asText(root.answer) ||
    asText(root.text) ||
    asText(root.output) ||
    asText(root.content) ||
    asText(root.summary)
  );
}

function extraCitationRows(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  const rows: unknown[] = [];
  for (const key of ['references', 'web_pages', 'webPages', 'sources'] as const) {
    if (Array.isArray(root[key])) rows.push(...root[key]);
  }
  return rows;
}

/** Map 秘塔问答 JSON (simple or chat_completions) onto the canvas search payload. */
export function parseMetasoQaResponse(data: unknown, size = 8): MetasoSearchResponse {
  const cap = Math.min(Math.max(size, 1), 20);
  const seen = new Set<string>();
  const webpages: MetasoWebpage[] = [];

  const push = (title: string, link: string, snippet: string, date: string) => {
    const url = link.trim();
    if (!url || seen.has(url.toLowerCase())) return;
    seen.add(url.toLowerCase());
    webpages.push({
      title: title.replace(/\s+/g, ' ').trim() || url,
      link: url,
      snippet: snippet.replace(/\s+/g, ' ').trim(),
      score: '',
      date,
    });
  };

  for (const hit of parseOpenRouterSearchHits(data)) {
    if (webpages.length >= cap) break;
    push(hit.title, hit.link, hit.snippet, hit.date ?? '');
  }

  if (webpages.length < cap) {
    const extra = parseOpenRouterSearchHits({ citations: extraCitationRows(data) });
    for (const hit of extra) {
      if (webpages.length >= cap) break;
      push(hit.title, hit.link, hit.snippet, hit.date ?? '');
    }
  }

  const brief = assistantText(data);
  return {
    credits: 0,
    total: webpages.length,
    webpages,
    ...(brief ? { brief } : {}),
  };
}
