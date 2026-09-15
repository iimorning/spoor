import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import {
  fulfillSearchToolFromNode,
  resolvePerplexityLiveQuery,
} from '../../src/services/fulfillSearchTool';
import { liveWebSearch } from '../../src/services/liveWebSearch';
import { filterWebpageHitsByQuestion } from '../../src/services/filterWebpageHitsByQuestion';
import { collectWebpageOgImages } from '../../src/services/attachWebpageOgImages';
import type { AIConfig } from '../../src/components/AISettingsModal';

vi.mock('../../src/lib/serverConfig', () => ({
  hasMetasoAccess: () => true,
  hasLiveWebSearchAccess: () => true,
}));

vi.mock('../../src/constants/webSearchBackend', () => ({
  LIVE_WEB_SEARCH_BACKEND: 'metaso',
  liveSearchMissingKeyI18nKey: () => 'nodes.search_no_metaso_key',
  liveSearchUsesImmediateUserQuestion: () => false,
  WIKIPEDIA_LIVE_ENRICH: true,
  WIKIPEDIA_LIVE_CAP: 3,
}));

vi.mock('../../src/services/liveWebSearch', () => ({
  liveWebSearch: vi.fn(),
}));

vi.mock('../../src/services/filterWebpageHitsByQuestion', () => ({
  filterWebpageHitsByQuestion: vi.fn(),
}));

vi.mock('../../src/services/attachWebpageOgImages', () => ({
  collectWebpageOgImages: vi.fn(async () => []),
}));

vi.mock('../../src/services/wikipediaEnrichment', () => ({
  createWikipediaEnrichmentLoader: () => ({
    load: vi.fn(async () => ({ credits: 0, total: 0, webpages: [], images: [] })),
  }),
  wikipediaWebpageHits: (res: { webpages?: unknown[] }) => res.webpages ?? [],
  wikipediaImageHits: (res: { images?: unknown[] }) => res.images ?? [],
}));

vi.mock('../../src/i18n', () => ({
  default: { language: 'zh-CN' },
}));

const searchMock = vi.mocked(liveWebSearch);
const webpageFilterMock = vi.mocked(filterWebpageHitsByQuestion);
const ogImagesMock = vi.mocked(collectWebpageOgImages);

describe('resolvePerplexityLiveQuery', () => {
  it('prefers the user question over DeepSeek keywords', () => {
    expect(
      resolvePerplexityLiveQuery('谷歌最新的模型怎么样', ['Gemini 3.1 2026', 'Google DeepMind']),
    ).toBe('谷歌最新的模型怎么样');
  });

  it('falls back to the first model query when there is no user turn', () => {
    expect(resolvePerplexityLiveQuery('  ', ['  Gemini 3.1  '])).toBe('Gemini 3.1');
  });
});

describe('fulfillSearchToolFromNode', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    searchMock.mockReset();
    webpageFilterMock.mockReset();
    ogImagesMock.mockReset();
    ogImagesMock.mockResolvedValue([]);
    await db.nodes.add({
      id: 'ai-1',
      canvasId: 'c1',
      type: 'ai',
      content: 'ok',
      x: 0,
      y: 0,
    });
  });

  it('skips empty queries, logs, and reports noResults without calling search', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onNoResults = vi.fn();
    const hits = await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      searches: [{ query: '   ', scopes: ['image'] }],
      apiKey: 'k',
      reportEmpty: true,
      onNoResults,
    });
    expect(hits).toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
    expect(onNoResults).toHaveBeenCalledWith({ scopes: ['image'] });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not alert when one scope times out but another returned results', async () => {
    searchMock.mockImplementation(async (_q, cfg) => {
      if (cfg.scope === 'image') throw new Error('秘塔搜索超时（30s）');
      return {
        credits: 0,
        total: 1,
        webpages: [{ title: 'A', link: 'https://a.example', snippet: 'x' }],
        images: [],
        videos: [],
        podcasts: [],
      };
    });
    const onError = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      searches: [{ query: 'cats', scopes: ['webpage', 'image'] }],
      apiKey: 'k',
      onError,
    });
    expect(onError).not.toHaveBeenCalled();
    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBeGreaterThan(1);
    warn.mockRestore();
  });

  it('spawns webpage results before waiting on a slower image scope', async () => {
    const order: string[] = [];
    searchMock.mockImplementation(async (_q, cfg) => {
      if (cfg.scope === 'webpage') {
        order.push('webpage-start');
        return {
          credits: 0,
          total: 1,
          webpages: [{ title: 'Page', link: 'https://p.example', snippet: 'p' }],
          images: [],
          videos: [],
          podcasts: [],
        };
      }
      await new Promise((r) => setTimeout(r, 40));
      order.push('image-done');
      return {
        credits: 0,
        total: 1,
        webpages: [],
        images: [{ title: 'Img', imageUrl: 'https://img.example/i.jpg', link: 'https://img.example' }],
        videos: [],
        podcasts: [],
      };
    });

    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      searches: [{ query: 'cats', scopes: ['webpage', 'image'] }],
      apiKey: 'k',
    });

    expect(order.indexOf('webpage-start')).toBeLessThan(order.indexOf('image-done'));
    const nodes = await db.nodes.toArray();
    expect(nodes.some((n) => n.type === 'text' && n.layout === 2)).toBe(true);
    expect(nodes.some((n) => n.type === 'image')).toBe(true);
  });

  it('rewrites book image queries using the 《title》 from the user question', async () => {
    searchMock.mockImplementation(async (q, cfg) => {
      if (cfg.scope === 'image') {
        expect(q).toBe('《我是许凉凉》 封面');
        return {
          credits: 0,
          total: 1,
          webpages: [],
          images: [{ title: 'Cover', imageUrl: 'https://img.example/c.jpg' }],
        };
      }
      return {
        credits: 0,
        total: 1,
        webpages: [{ title: 'Page', link: 'https://p.example', snippet: 'p' }],
      };
    });
    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      userQuestion: '介绍一下《我是许凉凉》这本书',
      searches: [{ query: '凉凉', scopes: ['webpage', 'image'] }],
      apiKey: 'k',
    });
    expect(searchMock).toHaveBeenCalledWith(
      '我是许凉凉 书',
      expect.objectContaining({ scope: 'webpage' }),
    );
    expect(searchMock).toHaveBeenCalledWith(
      '《我是许凉凉》 封面',
      expect.objectContaining({ scope: 'image' }),
    );
  });

  it('rewrites spoken book titles without 《》 for both webpage and image', async () => {
    searchMock.mockImplementation(async (_q, cfg) => {
      if (cfg.scope === 'image') {
        return {
          credits: 0,
          total: 1,
          webpages: [],
          images: [{ title: 'Cover', imageUrl: 'https://img.example/c.jpg' }],
        };
      }
      return {
        credits: 0,
        total: 1,
        webpages: [{ title: 'Page', link: 'https://p.example', snippet: 'p' }],
      };
    });
    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      userQuestion: '介绍一下我是许凉凉这本书',
      searches: [{ query: '凉凉', scopes: ['webpage', 'image'] }],
      apiKey: 'k',
    });
    expect(searchMock).toHaveBeenCalledWith(
      '我是许凉凉 书',
      expect.objectContaining({ scope: 'webpage' }),
    );
    expect(searchMock).toHaveBeenCalledWith(
      '《我是许凉凉》 封面',
      expect.objectContaining({ scope: 'image' }),
    );
  });

  it('does not spawn image cards whose titles miss the work name', async () => {
    searchMock.mockImplementation(async (_q, cfg) => {
      if (cfg.scope === 'image') {
        return {
          credits: 0,
          total: 2,
          webpages: [],
          images: [
            { title: '《我要做门阀》小说在线阅读', imageUrl: 'https://img.example/a.jpg' },
            { title: '《我是许凉凉》封面', imageUrl: 'https://img.example/b.jpg' },
          ],
        };
      }
      return {
        credits: 0,
        total: 0,
        webpages: [],
      };
    });
    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      userQuestion: '介绍一下我是许凉凉这本书',
      searches: [{ query: '凉凉', scopes: ['image'] }],
      apiKey: 'k',
    });
    const nodes = await db.nodes.toArray();
    const imgs = nodes.filter((n) => n.type === 'image');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.description ?? imgs[0]?.content).toMatch(/许凉凉/);
  });

  it('spawns only webpage hits the LLM filter keeps', async () => {
    const keep = { title: '我是许凉凉 - 豆瓣', link: 'https://book.douban.com/x', snippet: '李维菁', score: '', date: '' };
    const drop = { title: 'TR彻底凉凉', link: 'https://zhihu.example/x', snippet: '失败', score: '', date: '' };
    searchMock.mockResolvedValue({
      credits: 0,
      total: 2,
      webpages: [drop, keep],
      images: [],
    });
    webpageFilterMock.mockResolvedValue([keep]);
    const t = ((s: string) => s) as unknown as import('i18next').TFunction<'translation', undefined>;
    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      userQuestion: '介绍一下我是许凉凉这本书',
      searches: [{ query: '我是许凉凉', scopes: ['webpage'] }],
      apiKey: 'k',
      filterWebpages: {
        config: { provider: 'deepseek', apiKey: 'k', model: 'm' } as unknown as AIConfig,
        t,
      },
    });
    const notes = (await db.nodes.toArray()).filter((n) => n.type === 'text' && n.layout === 2);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toContain('我是许凉凉');
    expect(notes[0]?.content).not.toContain('彻底凉凉');
  });

  it('spawns og:image cards from kept webpage hits', async () => {
    const keep = {
      title: '我是许凉凉 - 豆瓣',
      link: 'https://book.douban.com/subject/1/',
      snippet: '李维菁',
      score: '',
      date: '',
    };
    searchMock.mockResolvedValue({
      credits: 0,
      total: 1,
      webpages: [keep],
      images: [],
    });
    ogImagesMock.mockResolvedValue([
      {
        title: '我是许凉凉 - 豆瓣',
        link: keep.link,
        imageUrl: 'https://img.douban.com/cover.jpg',
      },
    ]);
    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      userQuestion: '介绍一下我是许凉凉这本书',
      searches: [{ query: '我是许凉凉', scopes: ['webpage'] }],
      apiKey: 'k',
    });
    const imgs = (await db.nodes.toArray()).filter((n) => n.type === 'image');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.content).toBe('https://img.douban.com/cover.jpg');
    expect(imgs[0]?.sourceUrl).toBe(keep.link);
  });

  it('placeOnCanvas: false still catalogs hits without spawning canvas cards', async () => {
    searchMock.mockResolvedValue({
      credits: 0,
      total: 1,
      webpages: [{ title: 'Moon', link: 'https://moon.example', snippet: 'age', date: '2023' }],
      images: [],
      videos: [],
      podcasts: [],
    });
    const hits = await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      searches: [{ query: 'moon age', scopes: ['webpage'] }],
      apiKey: 'k',
      placeOnCanvas: false,
    });
    expect(hits.some((h) => h.link === 'https://moon.example')).toBe(true);
    const nodes = await db.nodes.toArray();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe('ai-1');
  });

  it('placeOnCanvas: false catalogs hits without a canvas node', async () => {
    searchMock.mockResolvedValue({
      credits: 0,
      total: 1,
      webpages: [{ title: 'Moon', link: 'https://moon.example', snippet: 'age' }],
      images: [],
      videos: [],
      podcasts: [],
    });
    const hits = await fulfillSearchToolFromNode({
      nodeId: 'essay:missing',
      searches: [{ query: 'moon age', scopes: ['webpage'] }],
      apiKey: 'k',
      placeOnCanvas: false,
    });
    expect(hits.some((h) => h.link === 'https://moon.example')).toBe(true);
    const nodes = await db.nodes.toArray();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe('ai-1');
  });
});
