import { db } from '../db';
import { hasLiveWebSearchAccess } from '../lib/serverConfig';
import { liveSearchUsesImmediateUserQuestion, WIKIPEDIA_LIVE_CAP } from '../constants/webSearchBackend';
import { liveWebSearch } from './liveWebSearch';
import type { MetasoImage, MetasoMediaItem, MetasoWebpage } from './search';
import type { SearchToolSpec } from '../utils/askTools';
import {
  attachPreviewImagesToSourceCards,
  spawnWebSearchCardsFromImages,
  spawnWebSearchCardsFromMedia,
  spawnWebSearchCardsFromPages,
} from './spawnWebSearchNoteCards';
import { joinSearchQueries, webSearchRelationContext } from '../utils/webSearchMediaCaption';
import { inferWorkTitle, hitMatchesWorkTitle, resolveScopedLiveQuery, resolveWikipediaLiveQuery, preferWikipediaHitsForIntent, sanitizeMetasoSearchQuery, simplifyLiveSearchQuery } from '../utils/liveImageSearchQuery';
import { logSearchChain } from '../utils/searchChainLog';
import type { AskSearchHit } from '../utils/askSearchHits';
import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { collectWebpageOgImages } from './attachWebpageOgImages';
import { filterWebpageHitsByQuestion } from './filterWebpageHitsByQuestion';
import {
  createWikipediaEnrichmentLoader,
  wikipediaImageHits,
  wikipediaWebpageHits,
} from './wikipediaEnrichment';
import i18n from '../i18n';

/** One Sonar call per AI card: mid-stream may emit several ```search fences. */
const perplexityLiveOnce = new Set<string>();

export function resetPerplexityLiveSearchOnceForTests(): void {
  perplexityLiveOnce.clear();
}

/**
 * Sonar wants a natural-language question, not DeepSeek keyword soup.
 * Fall back to the first model query only when the app has no user turn.
 */
export function resolvePerplexityLiveQuery(
  userQuestion: string | undefined,
  modelQueries: string[],
): string {
  const user = (userQuestion ?? '').replace(/\s+/g, ' ').trim();
  if (user) return user;
  for (const raw of modelQueries) {
    const q = raw.replace(/\s+/g, ' ').trim();
    if (q) return q;
  }
  return '';
}

const CAPS = {
  webpage: 8,
  image: 5,
  video: 3,
  podcast: 3,
} as const;

function pageKey(p: MetasoWebpage): string {
  return (p.link || p.title || '').trim().toLowerCase();
}

async function webpageHitsReadyToSpawn(
  incoming: MetasoWebpage[] | undefined,
  options: {
    userQuestion?: string;
    filterWebpages?: {
      config: AIConfig;
      t: TFunction<'translation', undefined>;
      sessionId?: string;
    };
  },
  searchQuery: string,
): Promise<MetasoWebpage[]> {
  const list = incoming ?? [];
  const question = options.userQuestion?.trim() ?? '';
  const gate = options.filterWebpages;
  if (list.length === 0 || !question || !gate) return list;
  return filterWebpageHitsByQuestion({
    pages: list,
    userQuestion: question,
    searchQuery,
    config: gate.config,
    t: gate.t,
    sessionId: gate.sessionId,
  });
}

function imageKey(img: MetasoImage): string {
  return (img.imageUrl || img.thumbnail || img.link || img.title || '').trim().toLowerCase();
}

function mediaKey(item: MetasoMediaItem): string {
  return (item.link || item.audioUrl || item.title || '').trim().toLowerCase();
}

function pushUnique<T>(list: T[], item: T, keyOf: (row: T) => string, cap: number): boolean {
  if (list.length >= cap) return false;
  const key = keyOf(item);
  if (!key) return false;
  if (list.some((row) => keyOf(row) === key)) return false;
  list.push(item);
  return true;
}

function collectUnique<T>(
  bucket: T[],
  incoming: T[] | undefined,
  keyOf: (row: T) => string,
  cap: number,
): T[] {
  const added: T[] = [];
  for (const item of incoming ?? []) {
    if (pushUnique(bucket, item, keyOf, cap)) added.push(item);
  }
  return added;
}

/**
 * Run live search for model-emitted specs. V1 pins source cards beside the AI reply; V2 lists hits in the side panel.
 * Backend is `LIVE_WEB_SEARCH_BACKEND` (Perplexity via OpenRouter, or Metaso).
 * Each scope is fetched and spawned as soon as it returns (no waiting for siblings).
 * Does not throw; reports missing key / empty / errors via callbacks.
 * Returns title/snippet catalog for optional search-then-reason synthesis.
 */
export async function fulfillSearchToolFromNode(options: {
  /** Canvas AI card. Optional when `placeOnCanvas` is false (essay / side-panel catalog). */
  nodeId?: string;
  searches: SearchToolSpec[];
  /** Original user turn — sent to Perplexity instead of DeepSeek keywords. */
  userQuestion?: string;
  apiKey?: string;
  openRouterApiKey?: string;
  llmProvider?: string;
  onMissingKey?: () => void;
  onError?: (message: string) => void;
  onNoResults?: (detail?: { scopes: Array<'webpage' | 'image' | 'video' | 'podcast'> }) => void;
  /** When false, empty responses are silent (used for mid-stream dispatches). */
  reportEmpty?: boolean;
  /** Optional LLM gate before webpage source cards spawn. */
  filterWebpages?: {
    config: AIConfig;
    t: TFunction<'translation', undefined>;
    sessionId?: string;
  };
  /**
   * Pin source cards beside the parent canvas node. Default true (V1 Ask cards).
   * Side-panel chat sets this false and shows hits on the thread message instead.
   */
  placeOnCanvas?: boolean;
}): Promise<AskSearchHit[]> {
  const searches = options.searches.slice(0, 3);
  if (searches.length === 0) return [];
  if (
    !hasLiveWebSearchAccess({
      metasoApiKey: options.apiKey,
      provider: options.llmProvider,
      llmApiKey: options.openRouterApiKey,
    })
  ) {
    options.onMissingKey?.();
    return [];
  }
  const node = options.nodeId ? await db.nodes.get(options.nodeId) : undefined;
  if (!node && options.placeOnCanvas !== false) return [];
  const apiKey = (options.apiKey ?? '').trim();
  const openRouterApiKey = (options.openRouterApiKey ?? '').trim();

  const pages: MetasoWebpage[] = [];
  const images: MetasoImage[] = [];
  const videos: MetasoMediaItem[] = [];
  const podcasts: MetasoMediaItem[] = [];
  const errors: string[] = [];
  const catalog: AskSearchHit[] = [];
  let skippedEmpty = 0;
  const requestedScopes: Array<'webpage' | 'image' | 'video' | 'podcast'> = [];

  const pushCatalog = (hit: AskSearchHit) => {
    catalog.push(hit);
  };

  const placeOnCanvas = options.placeOnCanvas !== false;
  const canvasId = node?.canvasId ?? '';
  const base = { x: node?.x ?? 0, y: node?.y ?? 0 };
  const anchorHeight = node?.height && node.height > 0 ? node.height : 200;
  const modelQueries = searches.map((s) => s.query);
  const relationContext = webSearchRelationContext(
    node ?? {},
    joinSearchQueries(
      liveSearchUsesImmediateUserQuestion() && options.userQuestion?.trim()
        ? [options.userQuestion]
        : modelQueries,
    ),
  );
  const searchScopeId = options.nodeId || `catalog:${options.userQuestion ?? modelQueries.join('|')}`;
  const wikiLoader = createWikipediaEnrichmentLoader(i18n.language);

  const pushPageCatalog = (query: string, batch: MetasoWebpage[]) => {
    for (const page of batch) {
      pushCatalog({
        kind: 'webpage',
        query,
        title: (page.title ?? '').trim(),
        snippet: (page.snippet ?? '').trim(),
        link: page.link?.trim() || undefined,
        imageUrl: (page.imageUrl ?? '').trim() || undefined,
        date: (page.date ?? '').trim() || undefined,
      });
    }
  };

  const pushImageCatalog = (query: string, batch: MetasoImage[]) => {
    for (const img of batch) {
      const imageUrl = (img.imageUrl || img.thumbnail || '').trim();
      pushCatalog({
        kind: 'image',
        query,
        title: (img.title ?? '').trim(),
        snippet: '',
        link: (img.link ?? img.imageUrl ?? '').trim() || undefined,
        imageUrl: imageUrl || undefined,
      });
    }
  };

  /** Dedupe Wikipedia + Metaso pages, then LLM-filter once before spawning. */
  const spawnFilteredWebpages = async (
    query: string,
    metasoPages: MetasoWebpage[] | undefined,
    laneCountExtra = 0,
  ) => {
    const wikiQuery = resolveWikipediaLiveQuery(query, options.userQuestion);
    const wiki = await wikiLoader.load(wikiQuery);
    const merged: MetasoWebpage[] = [];
    for (const page of [
      ...preferWikipediaHitsForIntent(
        wikipediaWebpageHits(wiki),
        options.userQuestion,
        query,
      ),
      ...(metasoPages ?? []),
    ]) {
      pushUnique(merged, page, pageKey, CAPS.webpage + WIKIPEDIA_LIVE_CAP);
    }
    const incoming = await webpageHitsReadyToSpawn(merged, options, query);
    const batch = collectUnique(pages, incoming, pageKey, CAPS.webpage);
    pushPageCatalog(query, batch);
    if (batch.length > 0) {
      const indexOffset = pages.length - batch.length;
      if (placeOnCanvas && options.nodeId) {
        await spawnWebSearchCardsFromPages(options.nodeId, base, batch, canvasId, {
          anchorHeight,
          indexOffset,
          laneCount: pages.length + laneCountExtra,
          staggerMs: 80,
        });
      }
      const ogImages = placeOnCanvas
        ? await collectWebpageOgImages(batch.filter((p) => !(p.imageUrl || '').trim()))
        : [];
      const keptLinks = new Set(batch.map((p) => (p.link ?? '').trim().toLowerCase()).filter(Boolean));
      const wikiThumbs = wikipediaImageHits(wiki).filter((img) => {
        const page = (img.link ?? '').trim().toLowerCase();
        return page && keptLinks.has(page);
      });
      const batchPreviews = batch
        .filter((p) => /^https?:\/\//i.test((p.imageUrl || '').trim()))
        .map((p) => ({
          title: p.title,
          link: p.link,
          imageUrl: p.imageUrl,
          thumbnail: p.imageUrl,
        }));
      const previewSources = [...wikiThumbs, ...batchPreviews, ...ogImages];
      if (placeOnCanvas && options.nodeId) {
        await attachPreviewImagesToSourceCards(options.nodeId, previewSources);
      }
      const imageBatch = collectUnique(
        images,
        previewSources,
        imageKey,
        CAPS.image + WIKIPEDIA_LIVE_CAP,
      );
      pushImageCatalog(query, imageBatch);
      if (placeOnCanvas && options.nodeId && imageBatch.length > 0) {
        await spawnWebSearchCardsFromImages(options.nodeId, base, imageBatch, canvasId, {
          anchorHeight,
          laneCount: imageBatch.length,
          staggerMs: 80,
          relationContext,
        });
      }
    }
  };

  if (liveSearchUsesImmediateUserQuestion()) {
    for (const spec of searches) requestedScopes.push(...spec.scopes);
    const query = resolvePerplexityLiveQuery(options.userQuestion, modelQueries);
    if (!query) {
      skippedEmpty += 1;
      console.warn('[Spoor] search tool skipped empty query', { scopes: requestedScopes });
    } else if (perplexityLiveOnce.has(searchScopeId)) {
      return catalog;
    } else {
      perplexityLiveOnce.add(searchScopeId);
      const ignored = modelQueries
        .map((q) => q.replace(/\s+/g, ' ').trim())
        .filter((q) => q && q !== query);
      if (ignored.length > 0) {
        console.info(
          `[Spoor] perplexity uses user question, ignoring model keywords ${JSON.stringify({
            query: query.slice(0, 80),
            ignored: ignored.map((q) => q.slice(0, 40)),
          })}`,
        );
      }
      try {
        const res = await liveWebSearch(query, {
          apiKey,
          openRouterApiKey,
          size: CAPS.webpage,
        });
        await spawnFilteredWebpages(query, res.webpages);
        const brief = (res.brief ?? '').trim();
        if (brief) {
          pushCatalog({
            kind: 'webpage',
            query,
            title: 'Live search brief',
            snippet: brief.slice(0, 2000),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Spoor] search tool failed', {
          query: query.slice(0, 80),
          backend: 'openrouter-perplexity',
          error: msg,
        });
        errors.push(msg);
      }
    }
  } else for (const spec of searches) {
    const query = sanitizeMetasoSearchQuery(spec.query.replace(/\s+/g, ' ').trim());
    requestedScopes.push(...spec.scopes);
    if (!query) {
      skippedEmpty += 1;
      console.warn('[Spoor] search tool skipped empty query', { scopes: spec.scopes });
      continue;
    }

    logSearchChain('02 query', {
      userQuestion: (options.userQuestion ?? '').slice(0, 500),
      inferredTitle: inferWorkTitle(options.userQuestion, query) || '(none)',
      modelQuery: query,
      scopes: spec.scopes,
      wikiQuery: resolveWikipediaLiveQuery(query, options.userQuestion),
    });

    for (const scope of spec.scopes) {
      const scopedQuery = resolveScopedLiveQuery(scope, query, options.userQuestion);
      logSearchChain(`03 provider.metaso.${scope}`, {
        modelQuery: query,
        sent: scopedQuery,
        rewritten: scopedQuery !== query,
      });
      let res;
      try {
        res = await liveWebSearch(scopedQuery, {
          apiKey,
          openRouterApiKey,
          scope,
          size: CAPS[scope],
        });
        const empty =
          scope === 'webpage'
            ? (res.webpages ?? []).length === 0
            : scope === 'image'
              ? (res.images ?? []).length === 0
              : scope === 'video'
                ? (res.videos ?? []).length === 0
                : (res.podcasts ?? []).length === 0;
        if (empty) {
          const retryQ = simplifyLiveSearchQuery(scopedQuery, options.userQuestion);
          if (retryQ && retryQ !== scopedQuery) {
            logSearchChain(`03 provider.metaso.${scope}.retry`, {
              from: scopedQuery,
              to: retryQ,
            });
            res = await liveWebSearch(retryQ, {
              apiKey,
              openRouterApiKey,
              scope,
              size: CAPS[scope],
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[Spoor] search tool failed scope=${scope} query=${JSON.stringify(scopedQuery.slice(0, 80))} error=${msg}`,
        );
        errors.push(msg);
        continue;
      }

      logSearchChain(`03 provider.metaso.${scope}.hits`, {
        sent: scopedQuery,
        webpages: (res.webpages ?? []).slice(0, 8).map((p) => p.title),
        images: (res.images ?? []).slice(0, 8).map((img) => ({
          title: img.title,
          link: (img.link ?? img.imageUrl ?? '').slice(0, 120),
        })),
        videos: (res.videos ?? []).slice(0, 4).map((v) => v.title),
        podcasts: (res.podcasts ?? []).slice(0, 4).map((p) => p.title),
      });

      if (scope === 'webpage') {
        await spawnFilteredWebpages(scopedQuery, res.webpages, videos.length + podcasts.length);
      } else if (scope === 'image') {
        const workTitle = inferWorkTitle(options.userQuestion, query);
        const incoming = res.images ?? [];
        const matched = workTitle
          ? incoming.filter((img) => hitMatchesWorkTitle(img, workTitle))
          : incoming;
        if (workTitle && incoming.length > 0) {
          logSearchChain('05 ranking.image-title', {
            workTitle,
            kept: matched.map((img) => img.title),
            dropped: incoming
              .filter((img) => !hitMatchesWorkTitle(img, workTitle))
              .map((img) => img.title),
          });
        }
        const batch = collectUnique(images, matched, imageKey, CAPS.image);
        pushImageCatalog(scopedQuery, batch);
        if (placeOnCanvas && options.nodeId && batch.length > 0) {
          await spawnWebSearchCardsFromImages(options.nodeId, base, batch, canvasId, {
            anchorHeight,
            laneCount: batch.length,
            staggerMs: 80,
            relationContext,
          });
        }
      } else if (scope === 'video') {
        const batch = collectUnique(videos, res.videos, mediaKey, CAPS.video);
        for (const item of batch) {
          pushCatalog({
            kind: 'video',
            query: scopedQuery,
            title: (item.title ?? '').trim(),
            snippet: (item.snippet ?? '').trim(),
            link: (item.link ?? '').trim() || undefined,
            imageUrl: (item.coverImage ?? '').trim() || undefined,
            date: (item.date ?? '').trim() || undefined,
          });
        }
        if (placeOnCanvas && options.nodeId && batch.length > 0) {
          const indexOffset = pages.length + videos.length - batch.length;
          await spawnWebSearchCardsFromMedia(options.nodeId, base, batch, canvasId, 'video', {
            anchorHeight,
            indexOffset,
            laneCount: pages.length + videos.length + podcasts.length,
            staggerMs: 80,
            relationContext,
          });
        }
      } else if (scope === 'podcast') {
        const batch = collectUnique(podcasts, res.podcasts, mediaKey, CAPS.podcast);
        for (const item of batch) {
          pushCatalog({
            kind: 'podcast',
            query: scopedQuery,
            title: (item.title ?? '').trim(),
            snippet: (item.snippet ?? '').trim(),
            link: (item.link ?? item.audioUrl ?? '').trim() || undefined,
            imageUrl: (item.coverImage ?? '').trim() || undefined,
            date: (item.date ?? '').trim() || undefined,
          });
        }
        if (placeOnCanvas && options.nodeId && batch.length > 0) {
          const indexOffset = pages.length + videos.length + podcasts.length - batch.length;
          await spawnWebSearchCardsFromMedia(options.nodeId, base, batch, canvasId, 'podcast', {
            anchorHeight,
            indexOffset,
            laneCount: pages.length + videos.length + podcasts.length,
            staggerMs: 80,
            relationContext,
          });
        }
      }
    }
  }

  if (pages.length + images.length + videos.length + podcasts.length === 0) {
    if (errors.length > 0) options.onError?.(errors[0]!);
    else if ((options.reportEmpty ?? false) && (skippedEmpty > 0 || searches.length > 0)) {
      options.onNoResults?.({ scopes: requestedScopes });
    }
    return catalog;
  }

  if (errors.length > 0) {
    console.warn('[Spoor] search tool partial failure', errors);
  }
  return catalog;
}
