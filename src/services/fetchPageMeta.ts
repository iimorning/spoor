import { fetchPageHtml, type FetchUrlResult } from './fetchPageHtml';
import { parsePageMeta, type PageMeta } from './parsePageMeta';

export type { FetchUrlResult };

/**
 * GET an http(s) page and parse title / description.
 * Desktop uses Tauri; browser uses the Vite `/api/fetch-page` proxy.
 */
export async function fetchPageMeta(url: string): Promise<PageMeta & { finalUrl: string }> {
  const { finalUrl, body } = await fetchPageHtml(url);
  const meta = parsePageMeta(body);
  return { ...meta, finalUrl };
}
