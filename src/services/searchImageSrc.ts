import { useEffect, useState } from 'react';
import { isTauriRuntime } from '../utils/isTauriRuntime';

export function searchImageReferer(imageUrl: string, pageUrl?: string): string {
  const page = (pageUrl ?? '').trim();
  if (/^https?:\/\//i.test(page)) return page;
  try {
    return `${new URL(imageUrl).origin}/`;
  } catch {
    return '';
  }
}

/** Same-origin Vite proxy so `<img>` can load hotlink-protected CDNs. */
export function browserSearchImageProxyUrl(imageUrl: string, referer?: string): string {
  const q = new URLSearchParams({ url: imageUrl });
  const r = (referer ?? '').trim();
  if (r) q.set('referer', r);
  return `/api/fetch-image?${q.toString()}`;
}

type TauriFetchImageRaw = {
  contentType?: string;
  content_type?: string;
  dataBase64?: string;
  data_base64?: string;
};

export async function fetchSearchImageBlobUrl(imageUrl: string, referer?: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const raw = await invoke<TauriFetchImageRaw>('fetch_image', {
    url: imageUrl,
    referer: referer || null,
  });
  const b64 = (raw.dataBase64 || raw.data_base64 || '').trim();
  if (!b64) throw new Error('Empty image body');
  const ct = (raw.contentType || raw.content_type || 'image/jpeg').split(';')[0]!.trim() || 'image/jpeg';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: ct }));
}

/**
 * Search image cards: proxy through Vite (browser) or Tauri (desktop).
 * Direct `<img src=cdn>` is blocked by Douban / Baidu hotlink rules.
 */
export function useSearchImageDisplaySrc(
  imageUrl: string,
  pageUrl: string | undefined,
  enabled: boolean,
): string {
  const src = (imageUrl || '').trim();
  const referer = searchImageReferer(src, pageUrl);
  const browserSrc =
    enabled && /^https?:\/\//i.test(src) && !isTauriRuntime()
      ? browserSearchImageProxyUrl(src, referer)
      : src;
  const [tauriSrc, setTauriSrc] = useState(src);

  useEffect(() => {
    if (!enabled || !/^https?:\/\//i.test(src) || !isTauriRuntime()) {
      setTauriSrc(src);
      return;
    }
    let cancelled = false;
    let blobUrl = '';
    void fetchSearchImageBlobUrl(src, referer)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        blobUrl = url;
        setTauriSrc(url);
      })
      .catch((err) => {
        console.warn('[Spoor] search image proxy failed', err);
        if (!cancelled) setTauriSrc(src);
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [enabled, src, referer]);

  if (!enabled || !/^https?:\/\//i.test(src)) return src;
  if (isTauriRuntime()) return tauriSrc;
  return browserSrc;
}
