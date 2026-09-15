import {
  WIKIPEDIA_LIVE_CAP,
  WIKIPEDIA_LIVE_ENRICH,
} from '../constants/webSearchBackend';
import { logSearchChain } from '../utils/searchChainLog';
import type { MetasoImage, MetasoSearchResponse, MetasoWebpage } from './search';
import { wikipediaSearch } from './wikipediaSearch';

const empty: MetasoSearchResponse = { credits: 0, total: 0, webpages: [], images: [] };

/**
 * One Wikipedia call per query string per Ask turn (webpage + image scopes share it).
 * Fail-open: never throws.
 */
export function createWikipediaEnrichmentLoader(appLang?: string): {
  load: (query: string) => Promise<MetasoSearchResponse>;
} {
  const cache = new Map<string, Promise<MetasoSearchResponse>>();
  return {
    load(query: string) {
      if (!WIKIPEDIA_LIVE_ENRICH) return Promise.resolve(empty);
      const q = query.replace(/\s+/g, ' ').trim();
      if (!q) return Promise.resolve(empty);
      const key = q.toLowerCase();
      let pending = cache.get(key);
      if (!pending) {
        pending = wikipediaSearch(q, { size: WIKIPEDIA_LIVE_CAP, appLang })
          .then((res) => {
            logSearchChain('03 provider.wikipedia', {
              query: q.slice(0, 80),
              webpages: (res.webpages ?? []).map((p) => ({
                title: p.title,
                host: (() => {
                  try {
                    return new URL(p.link).hostname;
                  } catch {
                    return '';
                  }
                })(),
              })),
              images: (res.images ?? []).map((img) => img.title),
            });
            return res;
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn('[Spoor] wikipedia enrich skipped', msg);
            return empty;
          });
        cache.set(key, pending);
      }
      return pending;
    },
  };
}

export function wikipediaWebpageHits(res: MetasoSearchResponse): MetasoWebpage[] {
  return res.webpages ?? [];
}

export function wikipediaImageHits(res: MetasoSearchResponse): MetasoImage[] {
  return res.images ?? [];
}
