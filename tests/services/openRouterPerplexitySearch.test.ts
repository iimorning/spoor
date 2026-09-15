import { describe, expect, it } from 'vitest';
import {
  formatLiveSearchQuestion,
  formatPerplexitySearchUserMessage,
  isMetasoSearchPayload,
  openRouterPerplexitySearchBody,
} from '../../src/services/openRouterPerplexitySearch';

describe('openRouterPerplexitySearchBody', () => {
  it('uses official sonar-pro + stream + Pro Search + month recency', () => {
    const now = new Date(2026, 8, 3, 12, 0, 0);
    const body = openRouterPerplexitySearchBody('谷歌最新的模型怎么样', now);
    expect(formatPerplexitySearchUserMessage('谷歌最新的模型怎么样', now)).toContain('2026-09-03');
    expect(formatPerplexitySearchUserMessage('谷歌最新的模型怎么样', now)).toContain(
      '谷歌最新的模型怎么样',
    );
    expect(formatPerplexitySearchUserMessage('谷歌最新的模型怎么样', now)).not.toContain(
      'newest publicly named',
    );
    expect(body.messages[0]?.content).toContain('谷歌最新的模型怎么样');
    expect(body.model).toBe('perplexity/sonar-pro');
    expect(body.stream).toBe(true);
    expect(body.search_recency_filter).toBe('month');
    expect(body.web_search_options.search_type).toBe('pro');
    expect(body.web_search_options.search_recency_filter).toBe('month');
  });
});

describe('formatLiveSearchQuestion', () => {
  it('passes a lone turn through', () => {
    expect(formatLiveSearchQuestion('谷歌最新的模型怎么样')).toBe('谷歌最新的模型怎么样');
  });

  it('prefixes earlier user turns for follow-ups', () => {
    expect(formatLiveSearchQuestion('对比其他家', ['谷歌最新的模型怎么样'])).toContain(
      '谷歌最新的模型怎么样',
    );
  });
});

describe('isMetasoSearchPayload', () => {
  it('detects a Metaso-only Edge response', () => {
    expect(isMetasoSearchPayload({ webpages: [{ title: 'A', link: 'https://a.example' }] })).toBe(
      true,
    );
    expect(
      isMetasoSearchPayload({
        model: 'perplexity/sonar',
        choices: [{ message: { content: 'ok' } }],
        search_results: [],
      }),
    ).toBe(false);
  });
});
