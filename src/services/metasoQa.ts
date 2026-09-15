import { isServerManaged, getFunctionsBase, resolveAccessToken, edgeFunctionHeaders } from '../lib/serverConfig';
import { parseMetasoQaResponse } from '../utils/parseMetasoQa';
import { assembleOpenRouterChatResponse } from '../utils/assembleOpenRouterSseChat';
import { resolveMetasoScope, type MetasoSearchConfig, type MetasoSearchResponse } from './search';

const LOG_PREFIX = '[Scribe AI][Search]';
const QA_TIMEOUT_MS = 45_000;

/** Official Search API 问答 (playground: 极速 + chat_completions). */
export const METASO_QA_PATH = '/api/v1/chat';

export function metasoQaRequestBody(query: string, scope = 'webpage') {
  return {
    q: query,
    scope,
    /** Playground default 极速. */
    model: 'fast',
    format: 'chat_completions',
    stream: false,
    conciseSnippet: true,
  };
}

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

function parseQaHttpBody(text: string, size: number): MetasoSearchResponse {
  const trimmed = text.trim();
  if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
    return parseMetasoQaResponse(assembleOpenRouterChatResponse(trimmed), size);
  }
  try {
    return parseMetasoQaResponse(JSON.parse(trimmed) as unknown, size);
  } catch {
    return parseMetasoQaResponse(assembleOpenRouterChatResponse(trimmed), size);
  }
}

async function fetchMetasoQa(url: string, init: RequestInit): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 404) return first;
  const alt = url.replace(/\/chat$/, '/chat/completions');
  if (alt === url) return first;
  return fetch(alt, init);
}

/**
 * Metaso Q&A (`/api/v1/chat`). Search (`/api/v1/search`) stays in `metasoSearch`.
 */
export async function metasoQa(
  query: string,
  config: MetasoSearchConfig,
): Promise<MetasoSearchResponse> {
  const apiKey = config.apiKey.trim();
  if (!isServerManaged() && !apiKey) {
    throw new Error('Metaso API key is empty');
  }

  const q = query.replace(/\s+/g, ' ').trim();
  const scope = resolveMetasoScope(config.scope);
  const size = Math.min(Math.max(config.size ?? 8, 1), 20);
  const body = metasoQaRequestBody(q, scope);

  console.info(`${LOG_PREFIX} metasoQa`, { query: q.slice(0, 160), scope, size, model: body.model });

  if (isServerManaged()) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error('服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或会话失效)。');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QA_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}/ai-search`, {
        method: 'POST',
        headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          provider: 'metaso-qa',
          q,
          scope,
          size,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        console.error(`${LOG_PREFIX} metasoQa HTTP ${response.status}`, text.slice(0, 500));
        throw new Error(`Metaso QA HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      return parseQaHttpBody(await response.text(), size);
    } catch (e) {
      if (isAbortError(e)) {
        throw new Error(
          `秘塔问答超时（${QA_TIMEOUT_MS / 1000}s）。服务器托管模式下由 Edge Function 访问 metaso.cn。`,
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const json = await invoke<string>('metaso_chat', {
        apiKey,
        query: q,
        scope,
      });
      return parseQaHttpBody(json, size);
    } catch (e) {
      console.error(`${LOG_PREFIX} Tauri metaso_chat failed`, e);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  const proxyUrl = `/api/metaso${METASO_QA_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QA_TIMEOUT_MS);

  try {
    const response = await fetchMetasoQa(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`${LOG_PREFIX} metasoQa HTTP ${response.status}`, text.slice(0, 500));
      throw new Error(`Metaso QA HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return parseQaHttpBody(await response.text(), size);
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error(
        `秘塔问答超时（${QA_TIMEOUT_MS / 1000}s）。请检查秘塔 Key 与 /api/metaso 代理。`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
