import { describe, expect, it } from 'vitest';
import {
  hitMatchesWorkTitle,
  inferWorkTitle,
  preferWikipediaHitsForIntent,
  quotedWorkTitle,
  resolveScopedLiveQuery,
  resolveWikipediaLiveQuery,
  sanitizeMetasoSearchQuery,
  simplifyLiveSearchQuery,
  unquotedWorkTitle,
} from '../../src/utils/liveImageSearchQuery';

describe('quotedWorkTitle', () => {
  it('prefers the longest 《》 title', () => {
    expect(quotedWorkTitle('介绍《我是许凉凉》这本书', '凉凉')).toBe('我是许凉凉');
  });
});

describe('unquotedWorkTitle', () => {
  it('takes the name before 这本书 and drops 介绍一下', () => {
    expect(unquotedWorkTitle('介绍一下我是许凉凉这本书')).toBe('我是许凉凉');
  });

  it('reads the line after Current question when Ask wraps history', () => {
    expect(
      unquotedWorkTitle(
        'Earlier in this thread:\n- 随便\n\nCurrent question:\n介绍一下我是许凉凉这本书',
      ),
    ).toBe('我是许凉凉');
  });
});

describe('inferWorkTitle', () => {
  it('prefers 《》 over the unquoted fallback', () => {
    expect(inferWorkTitle('介绍一下《短》这本书叫长书名这本书')).toBe('短');
  });
});

describe('resolveScopedLiveQuery', () => {
  it('rewrites webpage fragments to the full book title', () => {
    expect(
      resolveScopedLiveQuery('webpage', '凉凉', '介绍一下《我是许凉凉》这本书'),
    ).toBe('我是许凉凉 书');
  });

  it('rewrites spoken book titles without 《》', () => {
    expect(
      resolveScopedLiveQuery('webpage', '凉凉', '介绍一下我是许凉凉这本书'),
    ).toBe('我是许凉凉 书');
    expect(
      resolveScopedLiveQuery('image', '凉凉', '介绍一下我是许凉凉这本书'),
    ).toBe('《我是许凉凉》 封面');
  });

  it('rewrites book image search to quoted title plus 封面', () => {
    expect(
      resolveScopedLiveQuery('image', '凉凉', '介绍一下《我是许凉凉》这本书'),
    ).toBe('《我是许凉凉》 封面');
  });

  it('keeps an already visual full-title image query', () => {
    expect(
      resolveScopedLiveQuery('image', '我是许凉凉 封面', '《我是许凉凉》'),
    ).toBe('我是许凉凉 封面');
  });

  it('keeps a webpage query that already contains the full title', () => {
    expect(
      resolveScopedLiveQuery('webpage', '我是许凉凉 豆瓣', '介绍一下我是许凉凉这本书'),
    ).toBe('我是许凉凉 豆瓣');
  });
});

describe('resolveWikipediaLiveQuery', () => {
  it('uses a short book entity instead of author soup', () => {
    expect(
      resolveWikipediaLiveQuery('1984 乔治·奥威尔 小说', '给我介绍一下1984这本书吧'),
    ).toBe('1984 小说');
  });
});

describe('preferWikipediaHitsForIntent', () => {
  it('drops film pages when the user asked about a book', () => {
    const pages = [
      { title: '乔治·奥威尔', link: 'https://zh.wikipedia.org/wiki/乔治·奥威尔', snippet: '', score: '', date: '' },
      { title: '一九八四 (1984年电影)', link: 'https://zh.wikipedia.org/wiki/一九八四_(1984年电影)', snippet: '', score: '', date: '' },
      { title: '一九八四', link: 'https://zh.wikipedia.org/wiki/一九八四', snippet: '', score: '', date: '' },
    ];
    expect(
      preferWikipediaHitsForIntent(pages, '介绍一下1984这本书', '1984 小说').map((p) => p.title),
    ).toEqual(['乔治·奥威尔', '一九八四']);
  });
});

describe('sanitizeMetasoSearchQuery', () => {
  it('strips site: operators that Metaso cannot execute', () => {
    expect(
      sanitizeMetasoSearchQuery(
        'site:support.google.com/googleplay/android-developer Google Play 商店详情页 截图',
      ),
    ).toBe('Google Play 商店详情页 截图');
  });
});

describe('simplifyLiveSearchQuery', () => {
  it('retries with the inferred title', () => {
    expect(
      simplifyLiveSearchQuery('1984 乔治·奥威尔 小说', '介绍一下1984这本书'),
    ).toBe('1984');
  });

  it('retries by stripping search-engine operators first', () => {
    expect(
      simplifyLiveSearchQuery(
        'site:support.google.com/googleplay/android-developer Google Play 商店详情页',
      ),
    ).toBe('Google Play 商店详情页');
  });
});

describe('hitMatchesWorkTitle', () => {
  it('keeps covers that name 许凉凉 and drops other 我是/凉凉 web-novel art', () => {
    expect(
      hitMatchesWorkTitle({ title: '《我是许凉凉》封面' }, '我是许凉凉'),
    ).toBe(true);
    expect(
      hitMatchesWorkTitle({ title: '《我要做门阀》小说在线阅读-起点中文网' }, '我是许凉凉'),
    ).toBe(false);
    expect(
      hitMatchesWorkTitle({ title: 'TR彻底凉凉，赶紧找下家' }, '我是许凉凉'),
    ).toBe(false);
  });

  it('does not hard-drop image hits when the work title is a pure year', () => {
    expect(hitMatchesWorkTitle({ title: '一九八四 封面' }, '1984')).toBe(true);
    expect(hitMatchesWorkTitle({ title: 'unrelated cat meme' }, '1984')).toBe(true);
  });
});
