import { describe, expect, it } from 'vitest';
import { parseOpenRouterSearchHits } from '../../src/utils/parseOpenRouterSearchHits';

describe('parseOpenRouterSearchHits', () => {
  it('reads top-level citation URL strings', () => {
    const hits = parseOpenRouterSearchHits({
      citations: ['https://a.example/p', 'https://b.example/q'],
      choices: [{ message: { content: 'ok' } }],
    });
    expect(hits.map((h) => h.link)).toEqual(['https://a.example/p', 'https://b.example/q']);
    expect(hits[0]!.title).toBe('a.example');
  });

  it('reads message annotations url_citation objects', () => {
    const hits = parseOpenRouterSearchHits({
      choices: [
        {
          message: {
            content: 'see sources',
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  title: 'Alpha',
                  url: 'https://alpha.example',
                  snippet: 'about alpha',
                },
              },
            ],
          },
        },
      ],
    });
    expect(hits).toEqual([
      { title: 'Alpha', link: 'https://alpha.example', snippet: 'about alpha' },
    ]);
  });

  it('does not scrape markdown or JSON out of the assistant essay', () => {
    const jsonHits = parseOpenRouterSearchHits({
      choices: [
        {
          message: {
            content: '[{"title":"Json","url":"https://json.example","snippet":"s"}]',
          },
        },
      ],
    });
    expect(jsonHits).toEqual([]);

    const mdHits = parseOpenRouterSearchHits({
      choices: [
        {
          message: { content: 'See [CSP](https://www.w3.org/TR/CSP3/) for more.' },
        },
      ],
    });
    expect(mdHits).toEqual([]);
  });

  it('prefers Perplexity search_results over markdown in the essay', () => {
    const hits = parseOpenRouterSearchHits({
      search_results: [
        {
          title: 'Gemini 3',
          url: 'https://cnet.example/gemini',
          snippet: 'Google I/O coverage',
          date: '2026-08-01',
        },
      ],
      choices: [
        {
          message: {
            content:
              '### 1. 围栏基本解释\nSee [spam](https://spam.example/geo) for more.',
          },
        },
      ],
    });
    expect(hits).toEqual([
      { title: 'Gemini 3', link: 'https://cnet.example/gemini', snippet: 'Google I/O coverage', date: '2026-08-01' },
    ]);
  });

  it('accepts a pre-normalized webpages array', () => {
    const hits = parseOpenRouterSearchHits({
      webpages: [{ title: 'W', link: 'https://w.example', snippet: 'n' }],
    });
    expect(hits).toEqual([{ title: 'W', link: 'https://w.example', snippet: 'n' }]);
  });
});
