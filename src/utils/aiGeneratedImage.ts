import type { CanvasNode } from '../db';

/** True for illustrations the app generated (not Metaso search hits). */
export function isAiGeneratedImageNode(
  node: Pick<
    CanvasNode,
    'type' | 'aiGenerated' | 'webSearchParentId' | 'webSearchIndex' | 'sourceUrl' | 'content'
  >,
): boolean {
  if (node.type !== 'image') return false;
  if (node.aiGenerated) return true;
  if (node.webSearchParentId || typeof node.webSearchIndex === 'number') return false;
  const src = (node.sourceUrl ?? '').trim();
  const content = (node.content ?? '').trim();
  return Boolean(src && content && src === content);
}

export function illustrationDownloadFilename(title: string): string {
  const base =
    title
      .replace(/[^\w\u4e00-\u9fff\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'illustration';
  return `${base}.jpg`;
}

/**
 * Same-origin Vite/Netlify proxy for 302.AI file CDNs. Direct `fetch()` of
 * `file.302ai.cn` / `file.302.ai` is blocked by CORS even though `<img>` can
 * display them. Prefixes must not start with `/api/302` (that proxy is the
 * JSON API host and would swallow these paths).
 */
export function sameOriginCdnProxyUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const tail = `${parsed.pathname}${parsed.search}`;
  if (parsed.hostname === 'file.302ai.cn') return `/api/file-302cn${tail}`;
  if (parsed.hostname === 'file.302.ai') return `/api/file-302ai${tail}`;
  return null;
}

async function blobFromHttpUrl(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

function isSameOriginAssetPath(s: string): boolean {
  return s.startsWith('/') && !s.startsWith('//');
}

async function loadImageBlob(href: string): Promise<Blob> {
  const resolved = isSameOriginAssetPath(href.trim())
    ? new URL(href.trim(), typeof window !== 'undefined' ? window.location.origin : 'http://localhost').href
    : href;
  if (/^data:/i.test(resolved) || /^blob:/i.test(resolved)) {
    const res = await fetch(resolved);
    return res.blob();
  }

  const proxied = sameOriginCdnProxyUrl(resolved);
  const candidates = proxied ? [proxied, resolved] : [resolved];
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      return await blobFromHttpUrl(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('image download failed');
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking in the same turn can cancel the download in Chromium.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** Save an http(s) or data-URL image via a temporary blob link. */
export async function downloadImageUrl(url: string, filename: string): Promise<void> {
  const href = url.trim();
  if (!href) throw new Error('empty image url');
  triggerBlobDownload(await loadImageBlob(href), filename);
}

/** Fetch a canvas image href (data URL or http) into a multimodal `data:image/...;base64,...`. */
export async function imageHrefToDataUrl(href: string): Promise<string> {
  const trimmed = href.trim();
  if (!trimmed) throw new Error('empty image url');
  if (/^data:image\/[a-zA-Z0-9+.^-]+;base64,/s.test(trimmed)) return trimmed;
  const blob = await loadImageBlob(trimmed);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:image/')) {
        reject(new Error('image did not decode as a data URL'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('image read failed'));
    reader.readAsDataURL(blob);
  });
}
