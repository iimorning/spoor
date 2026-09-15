/**
 * Canvas live retrieval backend.
 * `'openrouter-perplexity'` — OpenRouter `perplexity/sonar` native search.
 * `'metaso'` — 秘塔 (Metaso). Mode is `METASO_LIVE_MODE`.
 */
export type LiveWebSearchBackend = 'metaso' | 'openrouter-perplexity';

export const LIVE_WEB_SEARCH_BACKEND: LiveWebSearchBackend = 'metaso';

/**
 * When `LIVE_WEB_SEARCH_BACKEND` is `'metaso'`:
 * `'qa'` — Ask/voice use `/api/v1/chat` (问答). Note chrome still uses `/search`.
 * `'search'` — Ask uses `/api/v1/search` (webpage / image / video / podcast).
 * Flip to `'qa'` to try Metaso Q&A without deleting that client.
 */
export type MetasoLiveMode = 'search' | 'qa';

export const METASO_LIVE_MODE: MetasoLiveMode = 'search';

/**
 * When true, Ask/voice webpage (and image) retrieval also queries Wikipedia.
 * Free, no key; fail-open so Metaso/Perplexity still run if wiki is down.
 */
export const WIKIPEDIA_LIVE_ENRICH = true;

/** Max Wikipedia page / thumbnail cards merged per live turn (zh + en combined). */
export const WIKIPEDIA_LIVE_CAP = 4;

export function isMetasoQaLive(): boolean {
  return LIVE_WEB_SEARCH_BACKEND === 'metaso' && METASO_LIVE_MODE === 'qa';
}

/** Sonar and 秘塔问答 both want the user's sentence, not model keyword fences. */
export function liveSearchUsesImmediateUserQuestion(): boolean {
  return LIVE_WEB_SEARCH_BACKEND === 'openrouter-perplexity' || isMetasoQaLive();
}

export function liveSearchMissingKeyI18nKey():
  | 'nodes.search_no_metaso_key'
  | 'nodes.search_no_openrouter_search' {
  return LIVE_WEB_SEARCH_BACKEND === 'metaso'
    ? 'nodes.search_no_metaso_key'
    : 'nodes.search_no_openrouter_search';
}

/** DeepSeek emits ```search to trigger retrieval; immediate-question backends skip that. */
export function liveSearchToolsPromptKey():
  | 'ai.prompts.askWebToolsAvailable'
  | 'ai.prompts.askWebToolsAvailablePerplexity'
  | 'ai.prompts.askWebToolsAvailableMetasoQa' {
  if (LIVE_WEB_SEARCH_BACKEND === 'openrouter-perplexity') {
    return 'ai.prompts.askWebToolsAvailablePerplexity';
  }
  if (isMetasoQaLive()) return 'ai.prompts.askWebToolsAvailableMetasoQa';
  return 'ai.prompts.askWebToolsAvailable';
}
