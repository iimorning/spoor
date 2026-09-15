import type { MetasoImage, MetasoWebpage } from './search';
import { fetchPageHtml } from './fetchPageHtml';
import { parsePageOgImage, resolvePagePreviewImageUrl } from './parsePageMeta';
import { logSearchChain } from '../utils/searchChainLog';

const CONCURRENCY = 3;

/**
 * After webpage hits are kept, pull og:image / twitter:image from each page
 * and map them to image cards (sourceUrl stays the article).
 */
export async function collectWebpageOgImages(pages: MetasoWebpage[]): Promise<MetasoImage[]> {
  const list = pages.filter((p) => /^https?:\/\//i.test((p.link ?? '').trim()));
  const out: MetasoImage[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const chunk = list.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(chunk.map((page) => ogImageForPage(page)));
    for (const row of rows) {
      if (!row) continue;
      const key = row.imageUrl!.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }

  logSearchChain('04 enrichment.og-image', {
    pages: list.length,
    images: out.map((img) => ({
      title: img.title,
      imageUrl: (img.imageUrl ?? '').slice(0, 160),
      page: (img.link ?? '').slice(0, 120),
    })),
  });
  return out;
}

async function ogImageForPage(page: MetasoWebpage): Promise<MetasoImage | null> {
  const pageUrl = page.link.trim();
  try {
    const { finalUrl, body } = await fetchPageHtml(pageUrl);
    const raw = parsePageOgImage(body);
    const imageUrl = resolvePagePreviewImageUrl(finalUrl || pageUrl, raw);
    if (!imageUrl) return null;
    return {
      title: (page.title || '').trim() || undefined,
      link: pageUrl,
      imageUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Spoor] webpage og:image skipped', { url: pageUrl.slice(0, 120), error: msg });
    return null;
  }
}
