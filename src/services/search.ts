const LOG_PREFIX = '[Scribe AI][Search]';
import { isServerManaged, getFunctionsBase, resolveAccessToken, edgeFunctionHeaders } from '../lib/serverConfig';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetasoSearchScope = 'webpage' | 'image' | 'video' | 'podcast';

export interface MetasoSearchConfig {
  apiKey: string;
  /** Default: webpage */
  scope?: MetasoSearchScope;
  /** Default: 5 */
  size?: number;
}

export interface MetasoWebpage {
  title: string;
  link: string;
  snippet: string;
  score: string;
  date: string;
  /** Optional preview (Wikipedia pageimage / og:image). */
  imageUrl?: string;
}

export interface MetasoImage {
  title?: string;
  /** Source page URL (when available) */
  link?: string;
  /** Direct image URL from Metaso (`imageUrl`) */
  imageUrl?: string;
  /** Alternate thumbnail / preview URL */
  thumbnail?: string;
}

/** Video / podcast hit (watch or listen page; not always a direct media file). */
export interface MetasoMediaItem {
  title?: string;
  link?: string;
  snippet?: string;
  authors?: string;
  duration?: string;
  date?: string;
  coverImage?: string;
  /** Podcast show / series name */
  showName?: string;
  /** Direct audio URL when Metaso provides one */
  audioUrl?: string;
}

export interface MetasoSearchResponse {
  credits: number;
  total: number;
  webpages: MetasoWebpage[];
  images?: MetasoImage[];
  videos?: MetasoMediaItem[];
  podcasts?: MetasoMediaItem[];
  /** Perplexity/Sonar assistant text — for synthesis, not a source card. */
  brief?: string;
}

const METASO_SCOPES: readonly MetasoSearchScope[] = ['webpage', 'image', 'video', 'podcast'];

export function resolveMetasoScope(raw: unknown): MetasoSearchScope {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (METASO_SCOPES as readonly string[]).includes(s) ? (s as MetasoSearchScope) : 'webpage';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
  );
}

function asHttpUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function asText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return '';
}

function asAuthors(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => asText(x))
      .filter(Boolean)
      .join(', ');
  }
  return asText(raw);
}

/** Official playground-shaped Search API body (size is a string there). */
export function metasoSearchRequestBody(
  query: string,
  scope: MetasoSearchScope,
  size: number,
): Record<string, unknown> {
  return {
    q: query,
    scope,
    size: String(Math.min(Math.max(size, 1), 20)),
    includeSummary: false,
    conciseSnippet: true,
  };
}

function pickResultArray(root: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const v = root[key];
    if (Array.isArray(v)) return v;
  }
  const data = root.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of keys) {
      const v = d[key];
      if (Array.isArray(v)) return v;
    }
    if (Array.isArray(d.results)) return d.results;
  }
  return [];
}

function normalizeMetasoWebpage(raw: unknown): MetasoWebpage | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const link =
    asHttpUrl(o.link) ||
    asHttpUrl(o.url) ||
    asHttpUrl(o.href) ||
    asHttpUrl(o.sourceUrl) ||
    asHttpUrl(o.source_url) ||
    '';
  const title = asText(o.title) || asText(o.name) || asText(o.headline) || link;
  const snippet =
    asText(o.snippet) ||
    asText(o.summary) ||
    asText(o.description) ||
    asText(o.abstract) ||
    '';
  if (!link && !title && !snippet) return null;
  return {
    title: title || link || '(untitled)',
    link,
    snippet,
    score: asText(o.score),
    date: asText(o.date) || asText(o.publishDate) || asText(o.displayDate),
  };
}

function diagnoseEmptyMetasoPayload(raw: unknown, scope: MetasoSearchScope): void {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const webRaw = pickResultArray(o, ['webpages', 'webpage', 'pages']);
  const imgRaw = pickResultArray(o, ['images', 'image']);
  console.warn(`${LOG_PREFIX} empty normalized hits`, {
    scope,
    topKeys: Object.keys(o).slice(0, 20),
    credits: o.credits,
    total: o.total,
    rawWebpageCount: webRaw.length,
    rawImageCount: imgRaw.length,
    sampleWebpageKeys:
      webRaw[0] && typeof webRaw[0] === 'object' ? Object.keys(webRaw[0] as object).slice(0, 12) : [],
    error: asText(o.error) || asText(o.message) || asText(o.msg) || undefined,
  });
}

function formatDuration(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string' && !/^\d+$/.test(raw.trim())) return raw.trim();
  const sec = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(sec) || sec < 0) return asText(raw);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function looksLikeImageUrl(url: string): boolean {
  if (!url) return false;
  const path = url.split('?')[0]?.split('#')[0] ?? url;
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\b|$)/i.test(path) || /\/image|img\.|cdn\.|pic\.|thumb/i.test(url);
}

/** Prefer Metaso `imageUrl`, then thumbnail, then an image-looking link. */
export function resolveMetasoImageUrl(img: MetasoImage): string {
  const imageUrl = asHttpUrl(img.imageUrl);
  if (imageUrl) return imageUrl;
  const thumb = asHttpUrl(img.thumbnail);
  if (thumb) return thumb;
  const link = asHttpUrl(img.link);
  if (link && looksLikeImageUrl(link)) return link;
  return link;
}

function normalizeMetasoImage(raw: unknown): MetasoImage | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const imageUrl =
    asHttpUrl(o.imageUrl) ||
    asHttpUrl(o.image_url) ||
    asHttpUrl(o.image) ||
    asHttpUrl(o.url) ||
    asHttpUrl(o.thumbnail) ||
    asHttpUrl(o.coverImage);
  const link =
    asHttpUrl(o.sourceUrl) ||
    asHttpUrl(o.source_url) ||
    asHttpUrl(o.link) ||
    asHttpUrl(o.pageUrl) ||
    '';
  const thumbnail = asHttpUrl(o.thumbnail) || asHttpUrl(o.coverImage) || '';
  const title =
    typeof o.title === 'string'
      ? o.title
      : typeof o.description === 'string'
        ? o.description
        : undefined;

  const normalized: MetasoImage = {
    title,
    link: link || undefined,
    imageUrl: imageUrl || undefined,
    thumbnail: thumbnail || undefined,
  };
  if (!resolveMetasoImageUrl(normalized)) return null;
  return normalized;
}

function normalizeMetasoMediaItem(raw: unknown): MetasoMediaItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const link =
    asHttpUrl(o.link) ||
    asHttpUrl(o.url) ||
    asHttpUrl(o.sourceUrl) ||
    asHttpUrl(o.source_url) ||
    asHttpUrl(o.audioUrl) ||
    '';
  const title = asText(o.title) || asText(o.name);
  const snippet = asText(o.snippet) || asText(o.description) || asText(o.abstract);
  if (!link && !title && !snippet) return null;

  return {
    title: title || undefined,
    link: link || undefined,
    snippet: snippet || undefined,
    authors: asAuthors(o.authors) || asAuthors(o.channel) || asAuthors(o.host) || undefined,
    duration: formatDuration(o.duration) || undefined,
    date: asText(o.date) || asText(o.publishDate) || asText(o.displayDate) || undefined,
    coverImage: asHttpUrl(o.coverImage) || asHttpUrl(o.thumbnail) || undefined,
    showName: asText(o.podcastName) || asText(o.show) || undefined,
    audioUrl: asHttpUrl(o.audioUrl) || undefined,
  };
}

/** Normalize API payloads so callers see images / videos / podcasts arrays. */
export function normalizeMetasoSearchResponse(raw: unknown): MetasoSearchResponse {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const webpages = pickResultArray(o, ['webpages', 'webpage', 'pages'])
    .map((item) => normalizeMetasoWebpage(item))
    .filter((item): item is MetasoWebpage => item != null);

  const rawImages = pickResultArray(o, ['images', 'image']);
  const images = rawImages
    .map((item) => normalizeMetasoImage(item))
    .filter((item): item is MetasoImage => item != null);

  if (rawImages.length > 0 && images.length === 0) {
    console.warn(`${LOG_PREFIX} received ${rawImages.length} image hits but none had a usable URL`, {
      sampleKeys: Object.keys((rawImages[0] as object) ?? {}),
    });
  }

  const rawVideos = pickResultArray(o, ['videos', 'video']);
  const videos = rawVideos
    .map((item) => normalizeMetasoMediaItem(item))
    .filter((item): item is MetasoMediaItem => item != null);

  const rawPodcasts = pickResultArray(o, ['podcasts', 'podcast']);
  const podcasts = rawPodcasts
    .map((item) => normalizeMetasoMediaItem(item))
    .filter((item): item is MetasoMediaItem => item != null);

  if (rawVideos.length > 0 && videos.length === 0) {
    console.warn(`${LOG_PREFIX} received ${rawVideos.length} video hits but none were usable`, {
      sampleKeys: Object.keys((rawVideos[0] as object) ?? {}),
    });
  }
  if (rawPodcasts.length > 0 && podcasts.length === 0) {
    console.warn(`${LOG_PREFIX} received ${rawPodcasts.length} podcast hits but none were usable`, {
      sampleKeys: Object.keys((rawPodcasts[0] as object) ?? {}),
    });
  }

  const out: MetasoSearchResponse = {
    credits: typeof o.credits === 'number' ? o.credits : 0,
    total:
      typeof o.total === 'number'
        ? o.total
        : images.length || videos.length || podcasts.length || webpages.length,
    webpages,
    images,
    videos,
    podcasts,
  };

  if (
    webpages.length === 0 &&
    images.length === 0 &&
    videos.length === 0 &&
    podcasts.length === 0
  ) {
    const sp =
      o.searchParameters && typeof o.searchParameters === 'object'
        ? (o.searchParameters as Record<string, unknown>)
        : null;
    diagnoseEmptyMetasoPayload(raw, resolveMetasoScope(sp?.scope ?? o.scope));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Core search function
// ---------------------------------------------------------------------------

const SEARCH_TIMEOUT_MS = 30_000;

function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

/**
 * Call the Metaso (秘塔) web search API.
 *
 * - **Tauri desktop**: uses a Rust-side HTTP command to avoid CORS.
 * - **Browser dev/preview**: uses the Vite `/api/metaso` proxy.
 */
export async function metasoSearch(
  query: string,
  config: MetasoSearchConfig,
): Promise<MetasoSearchResponse> {
  const apiKey = config.apiKey.trim();
  // Server-managed users don't need a local apiKey — the Edge Function reads
  // it from developer_secrets. Skip the key check for them.
  if (!isServerManaged() && !apiKey) {
    throw new Error('Metaso API key is empty');
  }

  const scope = resolveMetasoScope(config.scope);
  const size = Math.min(Math.max(config.size ?? 5, 1), 20);

  console.info(`${LOG_PREFIX} metasoSearch`, { query, scope, size });

  // ---- Server-managed Edge Function path (logged-in + useServerKeys) ----
  // Wins over both Tauri and Vite-proxy paths — the Edge Function has the
  // key server-side, so the browser never carries one.
  if (isServerManaged()) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error('服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或会话失效)。');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}/ai-search`, {
        method: 'POST',
        headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          provider: 'metaso',
          ...metasoSearchRequestBody(query, scope, size),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        console.error(`${LOG_PREFIX} HTTP ${response.status}`, text.slice(0, 500));
        throw new Error(`Metaso search HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const payload = await response.json();
      return normalizeMetasoSearchResponse(payload);
    } catch (e) {
      if (isAbortError(e)) {
        throw new Error(
          `秘塔搜索超时（${SEARCH_TIMEOUT_MS / 1000}s）。服务器托管模式下由 Edge Function 访问 metaso.cn；若部署区域到国内网络不通，请改用设置里的本地秘塔 Key，或关闭「使用服务器密钥」后重试。`,
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Tauri path --------------------------------------------------------
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const json = await invoke<string>('metaso_search', {
        apiKey,
        query,
        scope,
        size,
      });
      return normalizeMetasoSearchResponse(JSON.parse(json));
    } catch (e) {
      console.error(`${LOG_PREFIX} Tauri metaso_search failed`, e);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // ---- Browser path (Vite proxy) -----------------------------------------
  const proxyUrl = `/api/metaso/api/v1/search`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(metasoSearchRequestBody(query, scope, size)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`${LOG_PREFIX} HTTP ${response.status}`, text.slice(0, 500));
      throw new Error(`Metaso search HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return normalizeMetasoSearchResponse(await response.json());
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error(
        `秘塔搜索超时（${SEARCH_TIMEOUT_MS / 1000}s）。请检查秘塔 Key、本机网络，以及 Vite/Netlify 的 /api/metaso 代理是否可用。`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

/**
 * Turn raw search results into a text block that can be injected into an LLM
 * prompt as supplementary context.
 */
export function buildSearchContext(results: MetasoSearchResponse): string {
  const webpages = results.webpages ?? [];
  const images = results.images ?? [];
  const videos = results.videos ?? [];
  const podcasts = results.podcasts ?? [];
  if (webpages.length === 0 && images.length === 0 && videos.length === 0 && podcasts.length === 0) {
    return '';
  }

  const fragments: string[] = [];

  webpages.forEach((wp, idx) => {
    fragments.push(`[Source ${idx + 1}: ${wp.title}](${wp.link})\n${wp.snippet}`);
  });

  images.forEach((img, idx) => {
    const url = resolveMetasoImageUrl(img);
    const title = (img.title || 'Image').trim();
    const page = img.link && img.link !== url ? `\nPage: ${img.link}` : '';
    fragments.push(`[Image ${idx + 1}: ${title}]${url ? `(${url})` : ''}${page}`);
  });

  videos.forEach((v, idx) => {
    const meta = [v.authors, v.duration].filter(Boolean).join(' · ');
    fragments.push(
      `[Video ${idx + 1}: ${v.title || 'Video'}]${v.link ? `(${v.link})` : ''}${meta ? `\n${meta}` : ''}${v.snippet ? `\n${v.snippet}` : ''}`,
    );
  });

  podcasts.forEach((p, idx) => {
    const meta = [p.showName, p.authors, p.duration].filter(Boolean).join(' · ');
    const href = p.link || p.audioUrl || '';
    fragments.push(
      `[Podcast ${idx + 1}: ${p.title || 'Podcast'}]${href ? `(${href})` : ''}${meta ? `\n${meta}` : ''}${p.snippet ? `\n${p.snippet}` : ''}`,
    );
  });

  return [
    '--- Web search results ---',
    fragments.join('\n\n'),
    '--- End of search results ---',
  ].join('\n');
}
