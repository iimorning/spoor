/**
 * Dev-only HTML + image fetch so the browser can read og:image / hotlinked covers.
 * Mirrors Tauri `fetch_url` / `fetch_image` (size/time limited, http(s) only).
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

const PAGE_PATH = '/api/fetch-page';
const IMAGE_PATH = '/api/fetch-image';
const WIKIPEDIA_PATH = '/api/wikipedia';
const PAGE_MAX_BYTES = 512 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const WIKIPEDIA_MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 15_000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const WIKIPEDIA_UA = 'SpoorPro/1.0 (https://github.com/iimorning/spoor-pro; canvas live search)';

export function isBlockedFetchHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === 'metadata.google.internal') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

export function isWikipediaApiHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  return h === 'wikipedia.org' || h.endsWith('.wikipedia.org');
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (isBlockedFetchHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function htmlContentTypeOk(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (!ct) return true;
  return ct.includes('text/html') || ct.includes('application/xhtml') || ct.includes('text/plain');
}

function imageContentTypeOk(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (!ct) return true;
  return ct.startsWith('image/') || ct.includes('octet-stream');
}

async function handlePage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const params = new URL(req.url ?? '', 'http://127.0.0.1').searchParams;
  const parsed = parseHttpUrl(params.get('url') ?? '');
  if (!parsed) {
    res.statusCode = 400;
    res.end('Invalid URL');
    return;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(parsed.href, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!upstream.ok) {
      res.statusCode = 502;
      res.end(`HTTP ${upstream.status}`);
      return;
    }
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!htmlContentTypeOk(contentType)) {
      res.statusCode = 415;
      res.end(`Unsupported content type: ${contentType}`);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const body = buf.subarray(0, PAGE_MAX_BYTES).toString('utf8');
    if (!body.trim()) {
      res.statusCode = 502;
      res.end('Empty response body');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        finalUrl: upstream.url || parsed.href,
        contentType,
        body,
      }),
    );
  } catch (err) {
    res.statusCode = 502;
    res.end(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

async function handleImage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const params = new URL(req.url ?? '', 'http://127.0.0.1').searchParams;
  const parsed = parseHttpUrl(params.get('url') ?? '');
  if (!parsed) {
    res.statusCode = 400;
    res.end('Invalid URL');
    return;
  }
  const refererRaw = (params.get('referer') ?? '').trim();
  const referer = refererRaw && /^https?:\/\//i.test(refererRaw) ? refererRaw : '';

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (referer) headers.Referer = referer;
    const upstream = await fetch(parsed.href, {
      signal: ac.signal,
      redirect: 'follow',
      headers,
    });
    if (!upstream.ok) {
      res.statusCode = 502;
      res.end(`HTTP ${upstream.status}`);
      return;
    }
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!imageContentTypeOk(contentType)) {
      res.statusCode = 415;
      res.end(`Unsupported content type: ${contentType}`);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (!buf.length) {
      res.statusCode = 502;
      res.end('Empty image body');
      return;
    }
    if (buf.length > IMAGE_MAX_BYTES) {
      res.statusCode = 413;
      res.end('Image too large');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(buf.subarray(0, IMAGE_MAX_BYTES));
  } catch (err) {
    res.statusCode = 502;
    res.end(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

async function handleWikipedia(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const params = new URL(req.url ?? '', 'http://127.0.0.1').searchParams;
  const parsed = parseHttpUrl(params.get('url') ?? '');
  if (!parsed || !isWikipediaApiHost(parsed.hostname)) {
    res.statusCode = 400;
    res.end('Only wikipedia.org API URLs');
    return;
  }
  if (!parsed.pathname.includes('/w/api.php')) {
    res.statusCode = 400;
    res.end('Only MediaWiki api.php');
    return;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(parsed.href, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': WIKIPEDIA_UA,
        'Api-User-Agent': WIKIPEDIA_UA,
        Accept: 'application/json',
      },
    });
    if (!upstream.ok) {
      res.statusCode = 502;
      res.end(`HTTP ${upstream.status}`);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (!buf.length) {
      res.statusCode = 502;
      res.end('Empty response body');
      return;
    }
    if (buf.length > WIKIPEDIA_MAX_BYTES) {
      res.statusCode = 413;
      res.end('Response too large');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.end(buf.subarray(0, WIKIPEDIA_MAX_BYTES));
  } catch (err) {
    res.statusCode = 502;
    res.end(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

function attach(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const url = req.url ?? '';
    if (url.startsWith(IMAGE_PATH)) {
      void handleImage(req, res);
      return;
    }
    if (url.startsWith(PAGE_PATH)) {
      void handlePage(req, res);
      return;
    }
    if (url.startsWith(WIKIPEDIA_PATH)) {
      void handleWikipedia(req, res);
      return;
    }
    next();
  });
}

export function fetchPageProxyPlugin(): Plugin {
  return {
    name: 'fetch-page-proxy',
    apply: 'serve',
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
