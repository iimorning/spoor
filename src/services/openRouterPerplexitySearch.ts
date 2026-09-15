import { OPENROUTER_BASE_URL } from '../constants/openrouter';
import { isServerManaged, getFunctionsBase, resolveAccessToken, edgeFunctionHeaders } from '../lib/serverConfig';
import { parseOpenRouterSearchHits } from '../utils/parseOpenRouterSearchHits';
import {
  assembleOpenRouterChatResponse,
  perplexityAssistantText,
} from '../utils/assembleOpenRouterSseChat';
import { localCalendarIsoDate } from '../utils/localCalendarDate';
import type { MetasoSearchResponse } from './search';

const LOG_PREFIX = '[Scribe AI][Search]';
/** Pro Search is multi-step; 25s was aborting into thin Fast-Search-looking hits. */
const SEARCH_TIMEOUT_MS = 55_000;
export const OPENROUTER_PERPLEXITY_SEARCH_MODEL = 'perplexity/sonar-pro';

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
  );
}

function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

function hitsToMetaso(data: unknown, size: number): MetasoSearchResponse {
  const webpages = parseOpenRouterSearchHits(data)
    .slice(0, size)
    .map((h) => ({
      title: h.title,
      link: h.link,
      snippet: h.snippet,
      score: '',
      date: h.date ?? '',
    }));
  const brief = perplexityAssistantText(data);
  return { credits: 0, total: webpages.length, webpages, ...(brief ? { brief } : {}) };
}

/** True when ai-search still ran Metaso (old deploy) instead of OpenRouter chat. */
export function isMetasoSearchPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const o = data as Record<string, unknown>;
  const openRouterShaped =
    Array.isArray(o.choices) || Array.isArray(o.search_results) || Array.isArray(o.citations);
  return Array.isArray(o.webpages) && !openRouterShaped;
}

function logSearchPayload(via: 'edge' | 'browser', data: unknown): void {
  const root = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const message = Array.isArray(root.choices)
    ? (root.choices[0] as { message?: { annotations?: unknown[] } } | undefined)?.message
    : undefined;
  console.info(
    `${LOG_PREFIX} perplexity payload ${JSON.stringify({
      via,
      model: root.model ?? '(none)',
      searchType: 'pro',
      recency: 'month',
      keys: Object.keys(root),
      searchResults: Array.isArray(root.search_results) ? root.search_results.length : 0,
      citations: Array.isArray(root.citations) ? root.citations.length : 0,
      annotations: Array.isArray(message?.annotations) ? message.annotations.length : 0,
      briefChars: perplexityAssistantText(data).length,
      metasoWebpages: isMetasoSearchPayload(data),
      hitTitles: parseOpenRouterSearchHits(data)
        .slice(0, 8)
        .map((h) => h.title.slice(0, 48)),
    })}`,
  );
}

function openRouterHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'HTTP-Referer': 'https://spoor.ink',
    'X-Title': 'Spoor',
  };
}

/**
 * Ask-thread follow-ups (“对比其他家”) need prior user turns; Sonar has no chat history.
 */
export function formatLiveSearchQuestion(current: string, priorUserTurns: string[] = []): string {
  const now = current.replace(/\s+/g, ' ').trim();
  const prior = priorUserTurns
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s && s !== now)
    .slice(-2);
  if (!now) return prior.join('\n');
  if (prior.length === 0) return now;
  return `Earlier in this thread:\n${prior.map((p) => `- ${p}`).join('\n')}\n\nCurrent question:\n${now}`;
}

/**
 * Official Sonar Pro:
 * https://docs.perplexity.ai/docs/sonar/pro-search/quickstart
 * — User question as `messages` (date stamp only so “latest” is not training cutoff).
 * — `stream: true` is required or Pro Search silently becomes Fast Search.
 * — Canvas live search is “what’s current”, which the docs list as Pro Search
 *   (multi-step / comparative), not Fast fact-lookup. `auto` classifies short
 *   「怎么样」 as Fast, then ranks evergreen I/O recaps over newer model cards.
 * — `search_recency_filter` is the documented recency control (extra_body on
 *   Perplexity; also accepted on OpenRouter / in web_search_options).
 */
export function formatPerplexitySearchUserMessage(query: string, now = new Date()): string {
  return `Today is ${localCalendarIsoDate(now)}.\n\n${query.trim()}`;
}

export function openRouterPerplexitySearchBody(query: string, now = new Date()) {
  return {
    model: OPENROUTER_PERPLEXITY_SEARCH_MODEL,
    stream: true as const,
    messages: [{ role: 'user' as const, content: formatPerplexitySearchUserMessage(query, now) }],
    search_recency_filter: 'month' as const,
    web_search_options: {
      search_type: 'pro' as const,
      search_recency_filter: 'month' as const,
    },
  };
}

function chatCompletionsUrl(): string {
  if (isTauriRuntime()) return `${OPENROUTER_BASE_URL}/chat/completions`;
  return '/api/openrouter/chat/completions';
}

async function readOpenRouterChatBody(response: Response): Promise<unknown> {
  const text = await response.text();
  return assembleOpenRouterChatResponse(text);
}

/**
 * Perplexity Sonar Pro Search via OpenRouter. Source cards from `search_results`;
 * assistant text is returned as `brief` for the second-pass LLM.
 */
export async function openRouterPerplexitySearch(
  query: string,
  config: { apiKey: string; size?: number },
): Promise<MetasoSearchResponse> {
  const size = Math.min(Math.max(config.size ?? 5, 1), 20);
  const q = query.replace(/\s+/g, ' ').trim();
  console.info(
    `${LOG_PREFIX} openRouterPerplexitySearch ${JSON.stringify({
      query: q.slice(0, 160),
      size,
      searchType: 'pro',
      recency: 'month',
    })}`,
  );

  if (isServerManaged()) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error('服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或会话失效)。');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}/ai-search`, {
        method: 'POST',
        headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          provider: 'openrouter-perplexity',
          q,
          size,
          today: localCalendarIsoDate(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Perplexity search HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const data: unknown = await readOpenRouterChatBody(response);
      logSearchPayload('edge', data);
      if (isMetasoSearchPayload(data)) {
        throw new Error(
          '联网搜索没有打到 Perplexity：服务器 ai-search 仍在返回秘塔结果。请部署最新 supabase/functions/ai-search。',
        );
      }
      return hitsToMetaso(data, size);
    } catch (e) {
      if (isAbortError(e)) {
        throw new Error(`Perplexity 搜索超时（${SEARCH_TIMEOUT_MS / 1000}s）。`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new Error('OpenRouter API key is empty');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(openRouterPerplexitySearchBody(q)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(`${LOG_PREFIX} OpenRouter search HTTP ${response.status}`, text.slice(0, 500));
      throw new Error(`Perplexity search HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const data: unknown = await readOpenRouterChatBody(response);
    logSearchPayload('browser', data);
    return hitsToMetaso(data, size);
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error(`Perplexity 搜索超时（${SEARCH_TIMEOUT_MS / 1000}s）。请检查 OpenRouter Key 与网络。`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
