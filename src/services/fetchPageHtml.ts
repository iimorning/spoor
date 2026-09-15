import { isTauriRuntime } from '../utils/isTauriRuntime';

export type FetchUrlResult = {
  finalUrl: string;
  contentType: string;
  body: string;
};

type TauriFetchUrlRaw = {
  final_url?: string;
  finalUrl?: string;
  content_type?: string;
  contentType?: string;
  body?: string;
};

function normalizeFetchResult(raw: TauriFetchUrlRaw, fallbackUrl: string): FetchUrlResult {
  const finalUrl = (raw.final_url || raw.finalUrl || fallbackUrl).trim() || fallbackUrl;
  const contentType = (raw.content_type || raw.contentType || '').trim();
  const body = typeof raw.body === 'string' ? raw.body : '';
  return { finalUrl, contentType, body };
}

/**
 * GET page HTML: Tauri `fetch_url`, or Vite `/api/fetch-page` in browser dev.
 */
export async function fetchPageHtml(url: string): Promise<FetchUrlResult> {
  const target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    throw new Error('Invalid URL');
  }

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<TauriFetchUrlRaw>('fetch_url', { url: target });
    const result = normalizeFetchResult(raw, target);
    if (!result.body.trim()) throw new Error('Empty response body');
    return result;
  }

  const res = await fetch(`/api/fetch-page?url=${encodeURIComponent(target)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text.trim() || `HTTP ${res.status}`);
  }
  const raw = (await res.json()) as TauriFetchUrlRaw;
  const result = normalizeFetchResult(raw, target);
  if (!result.body.trim()) throw new Error('Empty response body');
  return result;
}
