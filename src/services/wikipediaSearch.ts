import type { MetasoImage, MetasoSearchResponse, MetasoWebpage } from './search';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import {
  edgeFunctionHeaders,
  getFunctionsBase,
  isServerManaged,
  resolveAccessToken,
} from '../lib/serverConfig';

const LOG = '[Spoor][wikipedia]';
const TIMEOUT_MS = 12_000;
/** Wikimedia asks non-browser clients to identify themselves. */
export const WIKIPEDIA_USER_AGENT =
  'SpoorPro/1.0 (https://github.com/iimorning/spoor-pro; canvas live search)';

export type WikipediaLang = 'zh' | 'en';

export function resolveWikipediaLang(query: string, appLang?: string): WikipediaLang {
  if (/[\u4e00-\u9fff]/.test(query)) return 'zh';
  if ((appLang ?? '').toLowerCase().startsWith('zh')) return 'zh';
  return 'en';
}

/** Primary wiki first (UI locale / query script), then the other language. */
export function resolveWikipediaLangOrder(query: string, appLang?: string): WikipediaLang[] {
  const primary = resolveWikipediaLang(query, appLang);
  return primary === 'zh' ? ['zh', 'en'] : ['en', 'zh'];
}

export function wikipediaApiOrigin(lang: WikipediaLang): string {
  return `https://${lang}.wikipedia.org`;
}

/** Map Chinese type suffixes to English for en.wikipedia — keep the disambiguator. */
export function wikipediaQueryForEnglish(query: string): string {
  const q = query.replace(/\s+/g, ' ').trim();
  if (!q) return q;
  const mapped = q.replace(
    /\s+(书|封面|电影|专辑|小说|海报)\s*$/u,
    (_, word: string) => {
      const table: Record<string, string> = {
        书: ' book',
        小说: ' novel',
        电影: ' film',
        专辑: ' album',
        封面: ' cover',
        海报: ' poster',
      };
      return table[word] ?? ` ${word}`;
    },
  );
  return mapped.trim() || q;
}

/** Build MediaWiki generator=search URL (extracts + pageimages + canonical URL). */
export function buildWikipediaSearchUrl(
  query: string,
  options?: { lang?: WikipediaLang; size?: number },
): string {
  const lang = options?.lang ?? resolveWikipediaLang(query);
  const size = Math.min(Math.max(options?.size ?? 3, 1), 8);
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    utf8: '1',
    generator: 'search',
    gsrsearch: query.trim(),
    gsrlimit: String(size),
    gsrnamespace: '0',
    prop: 'extracts|pageimages|info',
    inprop: 'url',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    piprop: 'thumbnail|original',
    pithumbsize: '800',
  });
  return `${wikipediaApiOrigin(lang)}/w/api.php?${params.toString()}`;
}

type WikiPage = {
  pageid?: number;
  index?: number;
  title?: string;
  extract?: string;
  fullurl?: string;
  canonicalurl?: string;
  thumbnail?: { source?: string; width?: number; height?: number };
  original?: { source?: string; width?: number; height?: number };
};

function asPages(raw: unknown): WikiPage[] {
  if (!raw || typeof raw !== 'object') return [];
  const query = (raw as { query?: { pages?: Record<string, WikiPage> } }).query;
  const pages = query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  return Object.values(pages).sort(
    (a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER),
  );
}

function truncateSnippet(text: string, max = 280): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

function pageUrl(page: WikiPage, lang: WikipediaLang): string {
  const direct = (page.fullurl || page.canonicalurl || '').trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const title = (page.title || '').trim();
  if (!title) return '';
  return `${wikipediaApiOrigin(lang)}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Map MediaWiki JSON into the same card shape Metaso uses. */
export function normalizeWikipediaResponse(
  raw: unknown,
  lang: WikipediaLang,
): MetasoSearchResponse {
  const pages = asPages(raw);
  const webpages: MetasoWebpage[] = [];
  const images: MetasoImage[] = [];

  for (const page of pages) {
    const title = (page.title || '').trim();
    const link = pageUrl(page, lang);
    if (!title && !link) continue;
    const snippet = truncateSnippet(page.extract || '');
    const thumb =
      (page.original?.source || '').trim() || (page.thumbnail?.source || '').trim();
    const imageUrl = /^https?:\/\//i.test(thumb) ? thumb : undefined;
    webpages.push({
      title: title || link,
      link,
      snippet,
      score: typeof page.index === 'number' ? String(page.index) : '',
      date: '',
      ...(imageUrl ? { imageUrl } : {}),
    });
    if (imageUrl) {
      images.push({
        title: title || undefined,
        link: link || undefined,
        imageUrl,
        thumbnail: imageUrl,
      });
    }
  }

  return {
    credits: 0,
    total: webpages.length,
    webpages,
    images,
  };
}

/** Interleave zh/en hits; dedupe by URL / compact title. */
export function mergeWikipediaResponses(
  parts: Array<{ lang: WikipediaLang; res: MetasoSearchResponse }>,
  cap: number,
): MetasoSearchResponse {
  const limit = Math.min(Math.max(cap, 1), 8);
  const webpages: MetasoWebpage[] = [];
  const images: MetasoImage[] = [];
  const seenPage = new Set<string>();
  const seenImg = new Set<string>();

  const pageKey = (p: MetasoWebpage) => {
    const link = (p.link || '').trim().toLowerCase();
    if (link) return `u:${link}`;
    return `t:${(p.title || '').replace(/\s+/g, '').toLowerCase()}`;
  };
  const imageKey = (img: MetasoImage) =>
    ((img.imageUrl || img.thumbnail || img.link || img.title || '') as string).trim().toLowerCase();

  const pageCursors = parts.map((p) => ({ list: p.res.webpages ?? [], i: 0 }));
  while (webpages.length < limit) {
    let progressed = false;
    for (const cur of pageCursors) {
      while (cur.i < cur.list.length) {
        const page = cur.list[cur.i++]!;
        const key = pageKey(page);
        if (!key || seenPage.has(key)) continue;
        seenPage.add(key);
        webpages.push(page);
        progressed = true;
        break;
      }
      if (webpages.length >= limit) break;
    }
    if (!progressed) break;
  }

  const imageCursors = parts.map((p) => ({ list: p.res.images ?? [], i: 0 }));
  while (images.length < limit) {
    let progressed = false;
    for (const cur of imageCursors) {
      while (cur.i < cur.list.length) {
        const img = cur.list[cur.i++]!;
        const key = imageKey(img);
        if (!key || seenImg.has(key)) continue;
        seenImg.add(key);
        images.push(img);
        progressed = true;
        break;
      }
      if (images.length >= limit) break;
    }
    if (!progressed) break;
  }

  return {
    credits: 0,
    total: webpages.length,
    webpages,
    images,
  };
}

async function fetchWikipediaViaEdge(
  query: string,
  lang: WikipediaLang,
  size: number,
  signal: AbortSignal,
): Promise<unknown> {
  const base = getFunctionsBase();
  const token = await resolveAccessToken();
  if (!base || !token) throw new Error('wikipedia edge unavailable');
  const res = await fetch(`${base}/ai-search`, {
    method: 'POST',
    headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ provider: 'wikipedia', q: query, lang, size }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text.trim() || `wikipedia edge HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchWikipediaJson(
  apiUrl: string,
  options: { query: string; lang: WikipediaLang; size: number },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Prefer Edge when server-managed: Wikipedia is often blocked on client networks.
    if (isServerManaged()) {
      try {
        return await fetchWikipediaViaEdge(
          options.query,
          options.lang,
          options.size,
          controller.signal,
        );
      } catch (err) {
        console.warn(`${LOG} edge fetch failed, trying local`, err);
      }
    }

    if (!isTauriRuntime() && typeof window !== 'undefined') {
      try {
        const proxied = await fetch(`/api/wikipedia?url=${encodeURIComponent(apiUrl)}`, {
          signal: controller.signal,
        });
        if (proxied.ok) return proxied.json();
        const text = await proxied.text().catch(() => '');
        console.warn(`${LOG} vite proxy HTTP ${proxied.status}`, text.slice(0, 200));
      } catch (err) {
        console.warn(`${LOG} vite proxy failed`, err);
      }
    }

    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': WIKIPEDIA_USER_AGENT,
        ...(isTauriRuntime() ? { 'User-Agent': WIKIPEDIA_USER_AGENT } : {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text.trim() || `HTTP ${res.status}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Free Wikipedia search (no API key). Queries zh + en by default (primary first).
 * Failures should be swallowed by callers.
 */
export async function wikipediaSearch(
  query: string,
  options?: {
    lang?: WikipediaLang;
    /** Defaults to both languages, primary first from query / app locale. */
    langs?: WikipediaLang[];
    size?: number;
    appLang?: string;
  },
): Promise<MetasoSearchResponse> {
  const q = query.replace(/\s+/g, ' ').trim();
  if (!q) {
    return { credits: 0, total: 0, webpages: [], images: [] };
  }
  const size = Math.min(Math.max(options?.size ?? 4, 1), 8);
  const langs =
    options?.langs && options.langs.length > 0
      ? options.langs
      : options?.lang
        ? [options.lang]
        : resolveWikipediaLangOrder(q, options?.appLang);
  const perLang = Math.max(1, Math.ceil(size / langs.length));

  console.info(`${LOG} search`, {
    langs,
    q: q.slice(0, 80),
    via: isServerManaged() ? 'edge-first' : 'local',
  });

  const parts = await Promise.all(
    langs.map(async (lang) => {
      try {
        // Keep type hints (小说/电影/…). For en.wikipedia, map Chinese suffixes
        // to English equivalents — never strip them to a bare year/title.
        const langQuery = lang === 'en' ? wikipediaQueryForEnglish(q) : q;
        const url = buildWikipediaSearchUrl(langQuery, { lang, size: perLang });
        const raw = await fetchWikipediaJson(url, { query: langQuery, lang, size: perLang });
        return { lang, res: normalizeWikipediaResponse(raw, lang) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG} lang=${lang} failed`, msg);
        return { lang, res: { credits: 0, total: 0, webpages: [], images: [] } as MetasoSearchResponse };
      }
    }),
  );

  return mergeWikipediaResponses(parts, size);
}
