import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI, type ChatMessage } from './ai';
import { parseLenientLlmJson } from '../utils/llmJson';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import {
  metasoSearch,
  resolveMetasoImageUrl,
  resolveMetasoScope,
  type MetasoImage,
  type MetasoMediaItem,
  type MetasoSearchScope,
  type MetasoWebpage,
} from './search';

export const NOTE_SEARCH_MAX_ROUNDS = 5;
export const NOTE_SEARCH_MAX_SEARCHES = 3;
export const NOTE_SEARCH_MAX_CARDS = 8;
export const NOTE_SEARCH_MAX_PAGES = 3;
export const NOTE_SEARCH_MAX_IMAGES = 5;
export const NOTE_SEARCH_MAX_VIDEOS = 3;
export const NOTE_SEARCH_MAX_PODCASTS = 3;

const FANOUT_SCOPES: readonly MetasoSearchScope[] = ['webpage', 'image', 'video', 'podcast'];

export type NoteSearchHitKind = MetasoSearchScope;

export type NoteSearchCatalogHit = {
  id: string;
  kind: NoteSearchHitKind;
  title: string;
  snippet: string;
  raw: MetasoWebpage | MetasoImage | MetasoMediaItem;
};

export type NoteSearchAgentAction =
  | { type: 'search'; scope: MetasoSearchScope; query: string }
  | { type: 'done'; hitIds: string[] };

const MEDIA_KINDS: readonly NoteSearchHitKind[] = ['image', 'video', 'podcast'];

const SCOPE_PREFIX: Record<MetasoSearchScope, string> = {
  webpage: 'web',
  image: 'img',
  video: 'vid',
  podcast: 'pod',
};

function cleanQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function asIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseNoteSearchAgentAction(rawText: string): NoteSearchAgentAction | null {
  let parsed: unknown;
  try {
    parsed = parseLenientLlmJson(rawText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const action = typeof o.action === 'string' ? o.action.trim().toLowerCase() : '';

  const query = cleanQuery(o.query ?? o.q ?? o.webQuery);
  const scope = resolveMetasoScope(o.scope ?? o.kind ?? o.tool);
  if (action === 'search' || (action === '' && query && (o.scope || o.kind))) {
    if (!query) return null;
    return { type: 'search', scope, query };
  }

  const ids = asIdList(o.ids ?? o.hitIds ?? o.picks ?? o.cards);
  if (action === 'done' || action === 'finish' || ids.length > 0) {
    return { type: 'done', hitIds: ids };
  }
  return null;
}

export function formatNoteSearchHitsForModel(
  scope: MetasoSearchScope,
  query: string,
  hits: NoteSearchCatalogHit[],
): string {
  if (hits.length === 0) {
    return `Tool result: ${scope} search for “${query}” returned 0 hits.`;
  }
  const lines = hits.map((h) => {
    const snip = h.snippet.replace(/\s+/g, ' ').trim().slice(0, 220);
    return `- [${h.id}] ${h.title}${snip ? ` — ${snip}` : ''}`;
  });
  return `Tool result: ${scope} search for “${query}” (${hits.length} hits). Use only these ids.\n${lines.join('\n')}`;
}

function formatCombinedToolResults(parts: string[]): string {
  return `${parts.join('\n\n')}\n\nReply with search or done JSON. Pick the most relevant [img-*], [vid-*], and [pod-*]; add [web-*] only when a page adds unique on-topic context. Skip a media type only if every hit in it is off-topic.`;
}

function nextHitId(kind: NoteSearchHitKind, counts: Record<NoteSearchHitKind, number>): string {
  const n = counts[kind];
  counts[kind] = n + 1;
  return `${SCOPE_PREFIX[kind]}-${n}`;
}

function catalogHitsFromSearch(
  scope: MetasoSearchScope,
  res: {
    webpages?: MetasoWebpage[];
    images?: MetasoImage[];
    videos?: MetasoMediaItem[];
    podcasts?: MetasoMediaItem[];
  },
  counts: Record<NoteSearchHitKind, number>,
): NoteSearchCatalogHit[] {
  if (scope === 'webpage') {
    return (res.webpages ?? [])
      .filter((p) => (p.title || p.snippet || p.link || '').trim())
      .map((p) => ({
        id: nextHitId('webpage', counts),
        kind: 'webpage' as const,
        title: (p.title || p.link || 'Source').replace(/\s+/g, ' ').trim(),
        snippet: (p.snippet || '').trim(),
        raw: p,
      }));
  }
  if (scope === 'image') {
    return (res.images ?? [])
      .filter((img) => resolveMetasoImageUrl(img))
      .map((img) => ({
        id: nextHitId('image', counts),
        kind: 'image' as const,
        title: (img.title || img.link || 'Image').replace(/\s+/g, ' ').trim(),
        snippet: (img.link || '').trim(),
        raw: img,
      }));
  }
  const items = scope === 'video' ? (res.videos ?? []) : (res.podcasts ?? []);
  return items
    .filter((p) => (p.title || p.snippet || p.link || p.audioUrl || '').trim())
    .map((p) => ({
      id: nextHitId(scope, counts),
      kind: scope,
      title: (p.title || p.link || scope).replace(/\s+/g, ' ').trim(),
      snippet: (p.snippet || p.showName || p.authors || '').trim(),
      raw: p,
    }));
}

export function resolveNoteSearchPicks(
  catalog: Map<string, NoteSearchCatalogHit>,
  hitIds: string[],
): NoteSearchCatalogHit[] {
  const out: NoteSearchCatalogHit[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let images = 0;
  let videos = 0;
  let podcasts = 0;
  for (const id of hitIds) {
    const hit = catalog.get(id);
    if (!hit || seen.has(id)) continue;
    if (hit.kind === 'webpage') {
      if (pages >= NOTE_SEARCH_MAX_PAGES) continue;
      pages += 1;
    } else if (hit.kind === 'image') {
      if (images >= NOTE_SEARCH_MAX_IMAGES) continue;
      images += 1;
    } else if (hit.kind === 'video') {
      if (videos >= NOTE_SEARCH_MAX_VIDEOS) continue;
      videos += 1;
    } else {
      if (podcasts >= NOTE_SEARCH_MAX_PODCASTS) continue;
      podcasts += 1;
    }
    seen.add(id);
    out.push(hit);
    if (out.length >= NOTE_SEARCH_MAX_CARDS) break;
  }
  return out;
}

function defaultSearchSize(scope: MetasoSearchScope): number {
  if (scope === 'webpage') return 6;
  if (scope === 'image') return 6;
  return 5;
}

function catalogKinds(catalog: Map<string, NoteSearchCatalogHit>): Set<NoteSearchHitKind> {
  return new Set([...catalog.values()].map((h) => h.kind));
}

function missingMediaKinds(
  catalog: Map<string, NoteSearchCatalogHit>,
  picks: NoteSearchCatalogHit[],
): NoteSearchHitKind[] {
  const have = catalogKinds(catalog);
  const picked = new Set(picks.map((h) => h.kind));
  return MEDIA_KINDS.filter((kind) => have.has(kind) && !picked.has(kind));
}

export async function runNoteSearchAgent(options: {
  noteText: string;
  linkedContext: string;
  metasoApiKey: string;
  aiConfig: AIConfig;
  t: TFunction<'translation', undefined>;
  search?: typeof metasoSearch;
  complete?: typeof callUniversalAI;
}): Promise<NoteSearchCatalogHit[]> {
  const search = options.search ?? metasoSearch;
  const complete = options.complete ?? callUniversalAI;
  const { noteText, linkedContext, metasoApiKey, aiConfig, t } = options;

  const catalog = new Map<string, NoteSearchCatalogHit>();
  const counts: Record<NoteSearchHitKind, number> = {
    webpage: 0,
    image: 0,
    video: 0,
    podcast: 0,
  };

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: combineSystemParts(getLocaleDirective(), t('ai.prompts.noteSearchAgentSystem')),
    },
    {
      role: 'user',
      content: t('ai.prompts.noteSearchAgentUser', {
        note: noteText.slice(0, 4000),
        linked: (linkedContext || '(none)').slice(0, 6000),
      }),
    },
  ];

  let searches = 0;
  let mediaNudgeSent = false;

  const ingestFanout = async (query: string): Promise<string[]> => {
    const results = await Promise.all(
      FANOUT_SCOPES.map((scope) =>
        search(query, {
          apiKey: metasoApiKey,
          scope,
          size: defaultSearchSize(scope),
        }),
      ),
    );
    return FANOUT_SCOPES.map((scope, i) => {
      const hits = catalogHitsFromSearch(scope, results[i]!, counts);
      for (const hit of hits) catalog.set(hit.id, hit);
      return formatNoteSearchHitsForModel(scope, query, hits);
    });
  };

  const autoFillImages = (picks: NoteSearchCatalogHit[]): NoteSearchCatalogHit[] => {
    if (picks.some((h) => h.kind === 'image')) return picks;
    const imgIds = [...catalog.values()]
      .filter((h) => h.kind === 'image')
      .map((h) => h.id)
      .slice(0, 4);
    if (imgIds.length === 0) return picks;
    return resolveNoteSearchPicks(catalog, [...picks.map((p) => p.id), ...imgIds]);
  };

  for (let round = 0; round < NOTE_SEARCH_MAX_ROUNDS; round++) {
    const raw = await complete({
      config: aiConfig,
      messages,
      temperature: 0.2,
      topP: 0.4,
    });
    messages.push({ role: 'assistant', content: raw ?? '' });
    const action = parseNoteSearchAgentAction(raw ?? '');

    if (!action) {
      messages.push({ role: 'user', content: t('ai.prompts.noteSearchAgentRetry') });
      continue;
    }

    if (action.type === 'done') {
      const picks = resolveNoteSearchPicks(catalog, action.hitIds);
      const missing = missingMediaKinds(catalog, picks);
      if (missing.length > 0 && !mediaNudgeSent) {
        mediaNudgeSent = true;
        messages.push({ role: 'user', content: t('ai.prompts.noteSearchAgentNeedMedia') });
        continue;
      }
      return autoFillImages(picks);
    }

    if (searches >= NOTE_SEARCH_MAX_SEARCHES) {
      messages.push({
        role: 'user',
        content: t('ai.prompts.noteSearchAgentNoMoreSearch'),
      });
      continue;
    }

    searches += 1;
    const parts = await ingestFanout(action.query);
    messages.push({
      role: 'user',
      content: formatCombinedToolResults(parts),
    });
  }

  return [];
}
