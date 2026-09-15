import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildWikipediaSearchUrl,
  mergeWikipediaResponses,
  normalizeWikipediaResponse,
  resolveWikipediaLang,
  resolveWikipediaLangOrder,
  wikipediaQueryForEnglish,
  wikipediaSearch,
} from '../../src/services/wikipediaSearch';

vi.mock('../../src/lib/serverConfig', () => ({
  isServerManaged: () => false,
  getFunctionsBase: () => '',
  resolveAccessToken: async () => null,
  edgeFunctionHeaders: () => ({}),
}));

describe('resolveWikipediaLang', () => {
  it('prefers Chinese when the query has CJK', () => {
    expect(resolveWikipediaLang('活着 余华', 'en')).toBe('zh');
  });

  it('uses app language when the query is Latin', () => {
    expect(resolveWikipediaLang('To Live Yu Hua', 'zh-CN')).toBe('zh');
    expect(resolveWikipediaLang('To Live Yu Hua', 'en')).toBe('en');
  });
});

describe('resolveWikipediaLangOrder', () => {
  it('always includes both zh and en, primary first', () => {
    expect(resolveWikipediaLangOrder('1984', 'zh-CN')).toEqual(['zh', 'en']);
    expect(resolveWikipediaLangOrder('1984', 'en')).toEqual(['en', 'zh']);
    expect(resolveWikipediaLangOrder('活着', 'en')).toEqual(['zh', 'en']);
  });
});

describe('mergeWikipediaResponses', () => {
  it('interleaves languages and caps the list', () => {
    const merged = mergeWikipediaResponses(
      [
        {
          lang: 'zh',
          res: {
            credits: 0,
            total: 1,
            webpages: [
              { title: '一九八四', link: 'https://zh.wikipedia.org/wiki/一九八四', snippet: '', score: '', date: '' },
            ],
            images: [],
          },
        },
        {
          lang: 'en',
          res: {
            credits: 0,
            total: 1,
            webpages: [
              {
                title: 'Nineteen Eighty-Four',
                link: 'https://en.wikipedia.org/wiki/Nineteen_Eighty-Four',
                snippet: '',
                score: '',
                date: '',
              },
            ],
            images: [],
          },
        },
      ],
      4,
    );
    expect(merged.webpages.map((p) => p.title)).toEqual(['一九八四', 'Nineteen Eighty-Four']);
  });
});

describe('buildWikipediaSearchUrl', () => {
  it('points at the language subdomain with generator=search', () => {
    const url = buildWikipediaSearchUrl('活着', { lang: 'zh', size: 3 });
    expect(url).toContain('https://zh.wikipedia.org/w/api.php?');
    expect(url).toContain('generator=search');
    expect(url).toContain('gsrsearch=');
    expect(url).toContain('piprop=thumbnail%7Coriginal');
    expect(url).toContain('origin=*');
  });
});

describe('normalizeWikipediaResponse', () => {
  it('maps extracts and thumbnails into webpage + image hits', () => {
    const res = normalizeWikipediaResponse(
      {
        query: {
          pages: {
            '2': {
              pageid: 2,
              index: 2,
              title: '许三观卖血记',
              extract: '另一本书。',
              fullurl: 'https://zh.wikipedia.org/wiki/许三观卖血记',
            },
            '1': {
              pageid: 1,
              index: 1,
              title: '活着',
              extract: '《活着》是余华的长篇小说。'.repeat(20),
              fullurl: 'https://zh.wikipedia.org/wiki/活着',
              thumbnail: { source: 'https://upload.wikimedia.org/cover.jpg', width: 200, height: 280 },
            },
          },
        },
      },
      'zh',
    );
    expect(res.webpages.map((p) => p.title)).toEqual(['活着', '许三观卖血记']);
    expect(res.webpages[0]?.snippet.length).toBeLessThanOrEqual(281);
    expect(res.webpages[0]?.imageUrl).toBe('https://upload.wikimedia.org/cover.jpg');
    expect(res.webpages[1]?.imageUrl).toBeUndefined();
    expect(res.images).toEqual([
      {
        title: '活着',
        link: 'https://zh.wikipedia.org/wiki/活着',
        imageUrl: 'https://upload.wikimedia.org/cover.jpg',
        thumbnail: 'https://upload.wikimedia.org/cover.jpg',
      },
    ]);
  });

  it('prefers original pageimage over thumbnail', () => {
    const res = normalizeWikipediaResponse(
      {
        query: {
          pages: {
            '1': {
              pageid: 1,
              index: 1,
              title: '一九八四',
              extract: '小说',
              fullurl: 'https://zh.wikipedia.org/wiki/一九八四',
              thumbnail: { source: 'https://upload.wikimedia.org/thumb.jpg' },
              original: { source: 'https://upload.wikimedia.org/original.jpg' },
            },
          },
        },
      },
      'zh',
    );
    expect(res.webpages[0]?.imageUrl).toBe('https://upload.wikimedia.org/original.jpg');
    expect(res.images[0]?.imageUrl).toBe('https://upload.wikimedia.org/original.jpg');
  });
});

describe('wikipediaQueryForEnglish', () => {
  it('maps Chinese type suffixes instead of stripping them', () => {
    expect(wikipediaQueryForEnglish('1984 小说')).toBe('1984 novel');
    expect(wikipediaQueryForEnglish('活着 书')).toBe('活着 book');
    expect(wikipediaQueryForEnglish('1984')).toBe('1984');
  });
});

describe('wikipediaSearch', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '1': {
                index: 1,
                title: '活着',
                extract: '简介',
                fullurl: 'https://zh.wikipedia.org/wiki/活着',
              },
            },
          },
        }),
      })),
    );
  });

  it('fetches zh and en together by default', async () => {
    const res = await wikipediaSearch('1984 小说', { appLang: 'zh-CN', size: 4 });
    expect(fetch).toHaveBeenCalled();
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('zh.wikipedia.org'))).toBe(true);
    expect(urls.some((u) => u.includes('en.wikipedia.org'))).toBe(true);
    const enUrl = urls.find((u) => u.includes('en.wikipedia.org')) ?? '';
    expect(decodeURIComponent(enUrl)).toContain('novel');
    expect(res.webpages.length).toBeGreaterThan(0);
  });

  it('can still pin a single language', async () => {
    vi.mocked(fetch).mockClear();
    await wikipediaSearch('活着', { lang: 'zh', size: 2 });
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes('zh.wikipedia.org'))).toBe(true);
  });
});
