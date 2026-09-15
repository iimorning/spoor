/**
 * Detect web / image / video / podcast search commands in the AI card follow-up box or voice transcript.
 * Returns `null` if the message is a normal follow-up / utterance.
 */

export type WebSearchKind = 'webpage' | 'image' | 'video' | 'podcast';

export interface WebSearchIntent {
  kind: WebSearchKind;
  explicitQuery: string;
}

const IMAGE_PREFIX_PATTERNS = [
  /^搜图\s*/,
  /^搜图片\s*/,
  /^图片搜索\s*/,
  /^搜索图片\s*/,
  /^查找图片\s*/,
  /^image\s*search\s*/i,
];

const VIDEO_PREFIX_PATTERNS = [
  /^搜视频\s*/,
  /^搜索视频\s*/,
  /^视频搜索\s*/,
  /^查找视频\s*/,
  /^video\s*search\s*/i,
];

const PODCAST_PREFIX_PATTERNS = [
  /^搜播客\s*/,
  /^搜索播客\s*/,
  /^播客搜索\s*/,
  /^查找播客\s*/,
  /^podcast\s*search\s*/i,
];

const WEBPAGE_PREFIX_PATTERNS = [
  /^联网搜索\s*/,
  /^联网检索\s*/,
  // ASR commonly transcribes “联网搜索” as these.
  /^全网搜索\s*/,
  /^全网检索\s*/,
  /^网上搜索\s*/,
  /^网络搜索\s*/,
  /^连网搜索\s*/,
  /^web\s*search\s*/i,
];

/**
 * Voice triggers (longer phrases first). Includes casual “搜索一下 / 帮我搜索”,
 * not only the product keyword “联网搜索”.
 */
const IMAGE_INLINE_TRIGGER = /搜图|搜图片|图片搜索|搜索图片|查找图片|image\s*search/i;
const VIDEO_INLINE_TRIGGER = /搜视频|搜索视频|视频搜索|查找视频|video\s*search/i;
const PODCAST_INLINE_TRIGGER = /搜播客|搜索播客|播客搜索|查找播客|podcast\s*search/i;

const WEBPAGE_INLINE_TRIGGER =
  /联网搜索|联网检索|全网搜索|全网检索|网上搜索|网络搜索|连网搜索|web\s*search|搜索一下|检索一下|搜一下|查一下|查一查|搜一搜|搜索下|帮我搜索|给我搜索|请搜索|搜索(?=[\s，,。？?！!]|$)/i;

/** Filler ASR often glues onto the trigger (“联网搜索功能”, “帮我…一下”). */
const QUERY_FILLER =
  /^(?:功能|一下|下|看看|查查|检索|搜一下|搜索一下)\s*/;

const POLITE_FILLER =
  /你能帮我|能不能帮我|可以帮我|能帮我|帮我|可不可以|请你|麻烦你|麻烦|请|你能|给我/g;

function cleanTrailingQuery(rest: string): string {
  return rest.replace(QUERY_FILLER, '').trim();
}

function buildInlineQuery(before: string, after: string): string {
  return `${before} ${after}`
    .replace(POLITE_FILLER, ' ')
    .replace(/[？?！!。，,、\s]+/g, ' ')
    .trim();
}

function matchPrefix(
  s: string,
  patterns: RegExp[],
  kind: WebSearchKind,
): WebSearchIntent | null {
  for (const re of patterns) {
    if (re.test(s)) {
      return { kind, explicitQuery: cleanTrailingQuery(s.replace(re, '')) };
    }
  }
  return null;
}

function matchInline(
  s: string,
  trigger: RegExp,
  kind: WebSearchKind,
): WebSearchIntent | null {
  const match = trigger.exec(s);
  if (!match || match.index == null) return null;
  const before = s.slice(0, match.index);
  const after = cleanTrailingQuery(s.slice(match.index + match[0].length));
  const query = buildInlineQuery(before, after);
  if (!query && kind !== 'webpage') {
    // Prefix-style voice (“搜视频”) with empty remainder is still a valid intent.
    return { kind, explicitQuery: '' };
  }
  if (!query) return null;
  return { kind, explicitQuery: query };
}

/**
 * Typed follow-up box: command must lead the message (product convention).
 * More specific media intents are matched before generic webpage search.
 */
export function parseThreadWebSearchIntent(raw: string): WebSearchIntent | null {
  const s = raw.trim();
  if (!s) return null;

  return (
    matchPrefix(s, IMAGE_PREFIX_PATTERNS, 'image') ||
    matchPrefix(s, VIDEO_PREFIX_PATTERNS, 'video') ||
    matchPrefix(s, PODCAST_PREFIX_PATTERNS, 'podcast') ||
    matchPrefix(s, WEBPAGE_PREFIX_PATTERNS, 'webpage')
  );
}

/**
 * Voice transcripts: accept mid-sentence and casual search asks
 * (“帮我搜索一下”, “查一下…”), not only a leading “联网搜索”.
 */
export function parseVoiceWebSearchIntent(raw: string): WebSearchIntent | null {
  const prefix = parseThreadWebSearchIntent(raw);
  if (prefix) return prefix;

  const s = raw.trim();
  if (!s) return null;

  return (
    matchInline(s, IMAGE_INLINE_TRIGGER, 'image') ||
    matchInline(s, VIDEO_INLINE_TRIGGER, 'video') ||
    matchInline(s, PODCAST_INLINE_TRIGGER, 'podcast') ||
    matchInline(s, WEBPAGE_INLINE_TRIGGER, 'webpage')
  );
}

/** User turn asks for live retrieval (product command or casual 搜/查 phrasing). */
export function userTurnRequestsLiveSearch(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (parseVoiceWebSearchIntent(s)) return true;
  return /(?:搜|查|检索|找(?:一?[下找找]))/i.test(s);
}

/** Build a Metaso spec from an explicit user search command. Empty query → null (model must write one). */
export function searchSpecFromWebSearchIntent(intent: WebSearchIntent): {
  query: string;
  scopes: Array<WebSearchKind>;
} | null {
  const query = intent.explicitQuery.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!query) return null;
  // Generic “联网搜索” should still pull images when the model forgets the fence.
  const scopes: WebSearchKind[] =
    intent.kind === 'webpage' ? ['webpage', 'image'] : [intent.kind];
  return { query, scopes };
}

export function searchNoResultsI18nKey(
  scopes: readonly WebSearchKind[],
):
  | 'nodes.search_no_images'
  | 'nodes.search_no_videos'
  | 'nodes.search_no_podcasts'
  | 'nodes.search_no_results' {
  const unique = [...new Set(scopes)];
  if (unique.length === 1) {
    if (unique[0] === 'image') return 'nodes.search_no_images';
    if (unique[0] === 'video') return 'nodes.search_no_videos';
    if (unique[0] === 'podcast') return 'nodes.search_no_podcasts';
  }
  // Mixed scopes (e.g. webpage + image) → generic copy, not “webpage only”.
  return 'nodes.search_no_results';
}
