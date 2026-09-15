import type { MetasoSearchScope, MetasoWebpage } from '../services/search';

const BOOKISH =
  /这本书|这本小说|这部小说|小说|散文集|诗集|著作|读物|\bbook\b|\bnovel\b|封面/i;
const FILMISH = /电影|影片|剧集|电视剧|\bfilm\b|\bmovie\b|海报/i;
const ALBUMISH = /专辑|唱片|\balbum\b/i;

const WORK_MARKER =
  /这本书|这本小说|这部小说|这本著作|这本读物|这本散文集|这本诗集|这部电影|这部影片|这部剧集|这部剧|这张专辑|这张唱片/;

const LEAD_IN =
  /^(?:请)?(?:你)?(?:帮我)?(?:先)?(?:再)?(?:给我)?(?:帮忙)?(?:介绍一下|介绍下|介绍|讲讲|说说|查一下|搜一下|搜索一下|了解一下|确认一下)+/;

/** Longest 《…》 title in the texts (user turn wins over a truncated model query). */
export function quotedWorkTitle(...texts: Array<string | undefined>): string {
  let best = '';
  for (const raw of texts) {
    if (!raw) continue;
    for (const m of raw.matchAll(/《([^》]{1,80})》/g)) {
      const t = (m[1] ?? '').replace(/\s+/g, ' ').trim();
      if (t.length > best.length) best = t;
    }
  }
  return best;
}

function stripLeadIn(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(LEAD_IN, '').trim();
    if (next === t) break;
    t = next;
  }
  return t.replace(/^[的了，,：:\s]+/, '').replace(/[《》「」『』""'']+/g, '').trim();
}

/** 「介绍一下我是许凉凉这本书」— title sits before 这本书 / 这部电影, no 《》 required. */
export function unquotedWorkTitle(...texts: Array<string | undefined>): string {
  let best = '';
  for (const raw of texts) {
    if (!raw) continue;
    const text = raw.replace(/\s+/g, ' ').trim();
    // Keep newlines so “Current question:\n介绍一下…这本书” still yields the last line.
    const original = raw.replace(/\r\n/g, '\n').trim();
    const marker = original.match(WORK_MARKER);
    if (!marker || marker.index == null) continue;
    const before = original.slice(0, marker.index);
    const lastLine = before.split('\n').map((s) => s.trim()).filter(Boolean).at(-1) ?? before;
    const t = stripLeadIn(lastLine);
    if (t.length < 2 || t.length > 40) continue;
    if (t.length > best.length) best = t;
  }
  return best;
}

export function inferWorkTitle(...texts: Array<string | undefined>): string {
  return quotedWorkTitle(...texts) || unquotedWorkTitle(...texts);
}

function visualHint(userQuestion: string, specQuery: string): 'book' | 'film' | 'album' | 'work' {
  const blob = `${userQuestion} ${specQuery}`;
  if (FILMISH.test(blob)) return 'film';
  if (ALBUMISH.test(blob)) return 'album';
  if (BOOKISH.test(blob) || /《/.test(blob)) return 'book';
  return 'work';
}

function alreadyVisual(query: string): boolean {
  return /封面|书封|书脊|海报|剧照|封面图|cover\b|poster\b/i.test(query);
}

function specNamesWork(spec: string, title: string): boolean {
  return spec.includes(title);
}

/** Distinctive core: 「我是许凉凉」→「许凉凉」, so 凉凉 slang / other「我是…」网文 drop. */
export function workTitleMatchNeedle(title: string): string {
  const compact = title.replace(/[《》\s]/g, '').trim();
  const core = compact.replace(/^(我是|我的)/, '');
  return core.length >= 2 ? core : compact;
}

export function hitMatchesWorkTitle(
  hit: { title?: string; link?: string; imageUrl?: string },
  workTitle: string,
): boolean {
  const needle = workTitleMatchNeedle(workTitle);
  if (!needle) return true;
  // Pure numeric titles (years, opus numbers) vary by locale — do not hard-drop;
  // the LLM webpage filter + search query handle aliases.
  if (/^\d{2,4}$/.test(needle)) return true;
  const blob = `${hit.title ?? ''} ${hit.link ?? ''} ${hit.imageUrl ?? ''}`.replace(/\s+/g, '');
  const full = workTitle.replace(/[《》\s]/g, '');
  return blob.includes(full) || blob.includes(needle);
}

/**
 * Model fences often emit a fragment (「凉凉」). Prefer the full work name from the
 * user turn; image vs webpage get different qualifiers.
 */
export function resolveScopedLiveQuery(
  scope: MetasoSearchScope,
  specQuery: string,
  userQuestion?: string,
): string {
  const spec = specQuery.replace(/\s+/g, ' ').trim();
  const user = (userQuestion ?? '').replace(/\s+/g, ' ').trim();
  const title = inferWorkTitle(user, spec);
  if (!title) return spec;

  const kind = visualHint(user, spec);
  const quoted = title.includes('《') ? title : `《${title}》`;

  if (scope === 'image') {
    if (alreadyVisual(spec) && specNamesWork(spec, title)) return spec;
    if (kind === 'film') return `${quoted} 海报`;
    if (kind === 'album') return `${quoted} 专辑封面`;
    return `${quoted} 封面`;
  }

  if (scope === 'webpage' || scope === 'video' || scope === 'podcast') {
    if (specNamesWork(spec, title)) return spec;
    if (kind === 'film') return `${title} 电影`;
    if (kind === 'album') return `${title} 专辑`;
    if (kind === 'book') return `${title} 书`;
    return title;
  }

  return spec;
}

/**
 * MediaWiki prefers a short entity title over a keyword soup.
 * Book/film intent gets a light type hint; author names are dropped.
 */
export function resolveWikipediaLiveQuery(
  specQuery: string,
  userQuestion?: string,
): string {
  const spec = specQuery.replace(/\s+/g, ' ').trim();
  const user = (userQuestion ?? '').replace(/\s+/g, ' ').trim();
  const title = inferWorkTitle(user, spec)?.replace(/[《》]/g, '').trim();
  const kind = visualHint(user, spec);
  if (title) {
    if (kind === 'book') return `${title} 小说`;
    if (kind === 'film') return `${title} 电影`;
    if (kind === 'album') return `${title} 专辑`;
    return title;
  }
  return spec
    .replace(/(?:介绍一下|介绍下|讲讲|说说|查一下|搜一下)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** When the user asked about a book, demote Wikipedia film/TV disambiguation hits. */
export function preferWikipediaHitsForIntent(
  pages: MetasoWebpage[],
  userQuestion?: string,
  specQuery?: string,
): MetasoWebpage[] {
  if (pages.length <= 1) return pages;
  const kind = visualHint(userQuestion ?? '', specQuery ?? '');
  if (kind !== 'book') return pages;
  const filmish = /电影|影片|电视剧|剧集|\bfilm\b|\bmovie\b|\bTV\b/i;
  const kept = pages.filter((p) => !filmish.test(`${p.title} ${p.link}`));
  return kept.length > 0 ? kept : pages;
}

/** Metaso does not understand Google/Bing search operators — strip before API calls. */
export function sanitizeMetasoSearchQuery(query: string): string {
  return query
    .replace(/\b(?:site|filetype|inurl|intitle):[^\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Shorter retry when Metaso returns zero hits for a long model query. */
export function simplifyLiveSearchQuery(
  specQuery: string,
  userQuestion?: string,
): string {
  const normalized = specQuery.replace(/\s+/g, ' ').trim();
  const stripped = sanitizeMetasoSearchQuery(normalized);
  if (stripped && stripped !== normalized) return stripped;
  const title = inferWorkTitle(userQuestion, specQuery)?.replace(/[《》]/g, '').trim();
  if (title && title !== normalized) return title;
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length <= 2) return '';
  return parts.slice(0, 2).join(' ');
}
