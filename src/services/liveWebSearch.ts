import { LIVE_WEB_SEARCH_BACKEND, isMetasoQaLive } from '../constants/webSearchBackend';
import { openRouterPerplexitySearch } from './openRouterPerplexitySearch';
import { metasoQa } from './metasoQa';
import { metasoSearch, resolveMetasoScope, type MetasoSearchConfig, type MetasoSearchResponse } from './search';

export type LiveWebSearchConfig = MetasoSearchConfig & {
  openRouterApiKey?: string;
};

/** Dispatches to Perplexity (OpenRouter) or Metaso based on LIVE_WEB_SEARCH_BACKEND. */
export async function liveWebSearch(
  query: string,
  config: LiveWebSearchConfig,
): Promise<MetasoSearchResponse> {
  if (LIVE_WEB_SEARCH_BACKEND === 'openrouter-perplexity') {
    return openRouterPerplexitySearch(query, {
      apiKey: config.openRouterApiKey ?? '',
      size: config.size,
    });
  }
  if (isMetasoQaLive() && resolveMetasoScope(config.scope) === 'webpage') {
    return metasoQa(query, config);
  }
  return metasoSearch(query, config);
}
