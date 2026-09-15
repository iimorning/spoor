import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { parseLenientLlmJson } from '../utils/llmJson';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { logSearchChain } from '../utils/searchChainLog';
import type { MetasoWebpage } from './search';

const WEB_ID = /^\[?web-(\d+)\]?$/i;

function asIndex(raw: unknown, hitCount: number): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < hitCount) {
    return raw;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    const m = WEB_ID.exec(t);
    if (m) {
      const n = Number.parseInt(m[1]!, 10);
      if (n >= 0 && n < hitCount) return n;
    }
    const n = Number.parseInt(t, 10);
    if (String(n) === t && n >= 0 && n < hitCount) return n;
  }
  return null;
}

/**
 * Parse `{ "ids": ["web-0", "web-2"] }` (or a bare index array).
 * `null` = unreadable → caller should keep all hits.
 */
export function parseWebpageFilterKeepIndices(raw: string, hitCount: number): number[] | null {
  if (hitCount <= 0) return [];
  let parsed: unknown;
  try {
    parsed = parseLenientLlmJson(raw);
  } catch {
    return null;
  }
  let list: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    const rawList = o.ids ?? o.keep ?? o.keepIds ?? o.hitIds;
    if (!Array.isArray(rawList)) return null;
    list = rawList;
  }
  if (!list) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of list) {
    const idx = asIndex(item, hitCount);
    if (idx == null || seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

export function formatWebpageHitsForFilter(pages: MetasoWebpage[]): string {
  return pages
    .map((p, i) => {
      const title = (p.title || '').replace(/\s+/g, ' ').trim() || '(untitled)';
      const snippet = (p.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 280);
      const link = (p.link || '').trim();
      return [`[web-${i}] ${title}`, snippet ? `    ${snippet}` : '', link ? `    ${link}` : '']
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function softKeepTokens(question: string): string[] {
  const out = new Set<string>();
  const cleaned = question.replace(/[《》「」『』""']/g, ' ');
  for (const part of cleaned.split(/[\s,，。！？、；：:;!?/|]+/)) {
    const t = part.trim();
    if (t.length >= 2) out.add(t);
  }
  for (const m of question.matchAll(/\d{3,4}/g)) out.add(m[0]!);
  for (const m of question.matchAll(/[\u4e00-\u9fff]{2,16}/g)) out.add(m[0]!);
  return [...out];
}

function hitSoftMatchesQuestion(page: MetasoWebpage, tokens: string[]): boolean {
  const blob = `${page.title} ${page.snippet} ${page.link}`;
  return tokens.some((tok) => tok.length >= 2 && blob.includes(tok));
}

/**
 * LLM gate before webpage source cards spawn. Fail-open on parse/API errors.
 */
export async function filterWebpageHitsByQuestion(options: {
  pages: MetasoWebpage[];
  userQuestion: string;
  searchQuery?: string;
  config: AIConfig;
  t: TFunction<'translation', undefined>;
  sessionId?: string;
}): Promise<MetasoWebpage[]> {
  const pages = options.pages;
  const question = options.userQuestion.replace(/\s+/g, ' ').trim();
  if (pages.length === 0 || !question) return pages;

  const catalog = formatWebpageHitsForFilter(pages);
  try {
    const raw = await callUniversalAI({
      config: options.config,
      systemInstruction: combineSystemParts(
        getLocaleDirective(),
        options.t('ai.prompts.askWebHitFilterSystem'),
      ),
      prompt: options.t('ai.prompts.askWebHitFilterUser', {
        question: question.slice(0, 2000),
        query: (options.searchQuery ?? '').slice(0, 200),
        catalog,
      }),
      temperature: 0.15,
      topP: 0.3,
      sessionId: options.sessionId,
    });
    const keep = parseWebpageFilterKeepIndices(raw ?? '', pages.length);
    if (keep == null) {
      logSearchChain('05 ranking.filter failed open', { reason: 'unparsed', raw: (raw ?? '').slice(0, 400) });
      return pages;
    }
    if (keep.length === 0 && pages.length > 0) {
      // Empty keep is usually over-pruning; soft-keep obvious token overlaps, else top hits.
      const tokens = softKeepTokens(question);
      const soft = pages.filter((p) => hitSoftMatchesQuestion(p, tokens));
      const fallback = soft.length > 0 ? soft : pages.slice(0, Math.min(3, pages.length));
      logSearchChain('05 ranking.filter empty → soft keep', {
        soft: soft.map((p) => p.title),
        fallback: fallback.map((p) => p.title),
        raw: (raw ?? '').slice(0, 200),
      });
      return fallback;
    }
    const kept = keep.map((i) => pages[i]!);
    logSearchChain('05 ranking.filter', {
      kept: kept.map((p) => p.title),
      dropped: pages.filter((_, i) => !keep.includes(i)).map((p) => p.title),
    });
    return kept;
  } catch (err) {
    logSearchChain('05 ranking.filter failed open', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return pages;
  }
}
