import type { MetasoSearchScope } from '../services/search';
import { extractDrawToolFromReply, stripOpenDrawFence, type DrawToolSpec } from './drawTool';
import { parseLenientLlmJson } from './llmJson';
import { stripThinking } from './stripThinking';

export type SearchToolSpec = {
  query: string;
  scopes: MetasoSearchScope[];
};

export const SEARCH_TOOL_MAX = 3;

const SEARCH_NAMES =
  /^(search|web_search|websearch|web-search|metaso|retrieve|lookup)$/i;

const ALL_SCOPES: readonly MetasoSearchScope[] = ['webpage', 'image', 'video', 'podcast'];

const SCOPE_ALIASES: Record<string, MetasoSearchScope> = {
  web: 'webpage',
  webpage: 'webpage',
  page: 'webpage',
  pages: 'webpage',
  image: 'image',
  images: 'image',
  img: 'image',
  photo: 'image',
  video: 'video',
  videos: 'video',
  podcast: 'podcast',
  podcasts: 'podcast',
  audio: 'podcast',
};

const DEFAULT_SCOPES: MetasoSearchScope[] = ['webpage', 'image'];

function asNonEmptyString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}

function resolveOneScope(raw: unknown): MetasoSearchScope | 'all' | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (key === 'all' || key === '*') return 'all';
  return SCOPE_ALIASES[key] ?? null;
}

export function normalizeSearchScopes(raw: unknown): MetasoSearchScope[] {
  const out: MetasoSearchScope[] = [];
  const seen = new Set<MetasoSearchScope>();
  const push = (scope: MetasoSearchScope) => {
    if (seen.has(scope)) return;
    seen.add(scope);
    out.push(scope);
  };
  const add = (v: unknown) => {
    const resolved = resolveOneScope(v);
    if (resolved === 'all') {
      for (const s of ALL_SCOPES) push(s);
      return;
    }
    if (resolved) push(resolved);
  };
  if (Array.isArray(raw)) {
    for (const item of raw) add(item);
  } else {
    add(raw);
  }
  return out.length > 0 ? out : [...DEFAULT_SCOPES];
}

function specFromSearchObj(obj: Record<string, unknown>): SearchToolSpec | null {
  const query =
    asNonEmptyString(obj.query, 200) ||
    asNonEmptyString(obj.q, 200) ||
    asNonEmptyString(obj.keywords, 200) ||
    asNonEmptyString(obj.keyword, 200);
  if (!query || isToolMetaSearchQuery(query)) return null;
  const scopesRaw = obj.scopes ?? obj.scope ?? obj.kind ?? obj.types ?? obj.type;
  return { query, scopes: normalizeSearchScopes(scopesRaw) };
}

/** Models sometimes search the word 围栏 because Chinese prompts called ```search a 围栏. */
function isToolMetaSearchQuery(query: string): boolean {
  const t = query.replace(/[`"'「」]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    t === '围栏' ||
    t === '代码块' ||
    t === '代码围栏' ||
    t === 'search fence' ||
    t === 'search block' ||
    t === 'search围栏'
  );
}

function looksLikeSearchPayload(obj: Record<string, unknown>): boolean {
  const action = String(obj.action ?? obj.name ?? obj.tool ?? '').toLowerCase();
  if (action && SEARCH_NAMES.test(action)) return true;
  if (typeof obj.query === 'string' && obj.query.trim()) {
    if ('scopes' in obj || 'scope' in obj || 'kind' in obj || 'types' in obj) return true;
  }
  return false;
}

function specFromJsonish(body: string): SearchToolSpec | null {
  try {
    const parsed = parseLenientLlmJson(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (!looksLikeSearchPayload(obj)) return null;
    return specFromSearchObj(obj);
  } catch {
    return null;
  }
}

function specFromSearchFenceBody(body: string): SearchToolSpec | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseLenientLlmJson(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const spec = specFromSearchObj(parsed as Record<string, unknown>);
      if (spec) return spec;
    }
  } catch {
    /* fall through to plain-text query */
  }
  const query = asNonEmptyString(trimmed.replace(/^["'`]+|["'`]+$/g, ''), 200);
  if (!query || query.startsWith('{') || isToolMetaSearchQuery(query)) return null;
  return { query, scopes: [...DEFAULT_SCOPES] };
}

function specFromToolCallBody(body: string): SearchToolSpec | null {
  try {
    const parsed = parseLenientLlmJson(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const name = String(obj.name ?? obj.action ?? obj.tool ?? '').toLowerCase();
    const args =
      obj.arguments && typeof obj.arguments === 'object' && !Array.isArray(obj.arguments)
        ? (obj.arguments as Record<string, unknown>)
        : obj.parameters && typeof obj.parameters === 'object' && !Array.isArray(obj.parameters)
          ? (obj.parameters as Record<string, unknown>)
          : obj;
    if (name && !SEARCH_NAMES.test(name)) return null;
    if (!name && !looksLikeSearchPayload(args) && !looksLikeSearchPayload(obj)) return null;
    return specFromSearchObj(args) || specFromSearchObj(obj);
  } catch {
    return null;
  }
}

export function searchToolSpecKey(spec: SearchToolSpec): string {
  return `${spec.query.toLowerCase()}|${[...spec.scopes].sort().join(',')}`;
}

/**
 * 摘抄本：书籍对话里模型主动要用户存下的那些摘抄时才输出，和 search 一样放在
 * JSON 之后。默认不给（不给才不占 token），要了才把整个文件夹递过去。
 */
const EXCERPT_NAMES =
  /^(?:excerpts?|book_?excerpts?|my_?excerpts?|saved_?excerpts?)$/i;
const EXCERPT_FENCE =
  /```[ \t]*(?:excerpts?|book_?excerpts?|my_?excerpts?|saved_?excerpts?)\b[^\n`]*\r?\n?([\s\S]*?)(?:```|$)/gi;

function isExcerptCall(body: string): boolean {
  try {
    const parsed = parseLenientLlmJson(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const obj = parsed as Record<string, unknown>;
    return EXCERPT_NAMES.test(String(obj.name ?? obj.action ?? obj.tool ?? '').trim());
  } catch {
    return false;
  }
}

function dedupeSearches(searches: SearchToolSpec[]): SearchToolSpec[] {
  const out: SearchToolSpec[] = [];
  const seen = new Set<string>();
  for (const spec of searches) {
    const key = searchToolSpecKey(spec);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec);
    if (out.length >= SEARCH_TOOL_MAX) break;
  }
  return out;
}

/**
 * Pull search + draw + excerpt-folder tool requests out of a model reply.
 * Search is stripped first so a ```search / search tool_call never leaks into prose.
 */
export function extractAskToolsFromReply(text: string): {
  prose: string;
  images: DrawToolSpec[];
  searches: SearchToolSpec[];
  /** 模型要打开摘抄本（只有书籍对话有那个文件夹，长文这边拿到也没人用）。 */
  wantsSavedExcerpts: boolean;
} {
  if (!text) return { prose: '', images: [], searches: [], wantsSavedExcerpts: false };
  const searches: SearchToolSpec[] = [];
  let wantsSavedExcerpts = false;
  let s = text;

  // 摘抄本先剥：它常排在 search 前面，先摘干净，后面的正则才不会被半截围栏带偏。
  s = s.replace(EXCERPT_FENCE, () => {
    wantsSavedExcerpts = true;
    return '\n';
  });

  s = s.replace(/```search\s*\r?\n?([\s\S]*?)```/gi, (_, body: string) => {
    const spec = specFromSearchFenceBody(body);
    if (spec) searches.push(spec);
    return '\n';
  });

  s = s.replace(/```json\s*\r?\n?([\s\S]*?)```/gi, (full, body: string) => {
    const spec = specFromJsonish(body);
    if (!spec) return full;
    searches.push(spec);
    return '\n';
  });

  s = s.replace(
    /(?:```tool_call\s*\r?\n?|\[?<tool_call>)\s*([\s\S]*?)(?:<\/tool_call>|```|$)/gi,
    (full, body: string) => {
      const spec = specFromToolCallBody(body);
      if (!spec) return full;
      searches.push(spec);
      return '\n';
    },
  );

  const trimmedEnd = s.match(/\n[ \t]*(\{[\s\S]*\})[ \t]*$/);
  if (trimmedEnd?.[1]) {
    // 尾部残留 JSON 先问一句"是不是要摘抄本"，是的话整块吃掉，别留给 search 那条路。
    const excerptTail = isExcerptCall(trimmedEnd[1]);
    const spec = excerptTail ? null : specFromJsonish(trimmedEnd[1]);
    if (excerptTail || spec) {
      if (spec) searches.push(spec);
      if (excerptTail) wantsSavedExcerpts = true;
      s = s.slice(0, trimmedEnd.index);
    }
  }

  const drawn = extractDrawToolFromReply(s);
  return {
    prose: stripThinking(drawn.prose),
    images: drawn.images,
    searches: dedupeSearches(searches),
    wantsSavedExcerpts,
  };
}

/** Hide an unclosed ```search / ```excerpts / ```draw / draw-shaped ```json while streaming. */
export function stripOpenAskToolFence(text: string): string {
  if (!text) return text;
  return stripOpenFenceFrom(text, ['```search', '```excerpts']);
}

/** 把从最后一个"还没闭合的工具围栏"起的内容整段砍掉。 */
function stripOpenFenceFrom(text: string, markers: string[]): string {
  const afterDraw = stripOpenDrawFence(text);
  const open = markers
    .map((marker) => ({ marker, idx: text.lastIndexOf(marker) }))
    .filter((hit) => hit.idx >= 0)
    .sort((a, b) => b.idx - a.idx)[0];
  if (!open) return afterDraw;
  const afterMarker = text.slice(open.idx + 3);
  if (afterMarker.includes('```')) return afterDraw;
  return stripOpenDrawFence(text.slice(0, open.idx).trimEnd());
}
