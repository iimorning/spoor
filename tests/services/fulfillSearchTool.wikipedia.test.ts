import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { fulfillSearchToolFromNode } from '../../src/services/fulfillSearchTool';
import { liveWebSearch } from '../../src/services/liveWebSearch';
import { createWikipediaEnrichmentLoader } from '../../src/services/wikipediaEnrichment';

vi.mock('../../src/lib/serverConfig', () => ({
  hasMetasoAccess: () => true,
  hasLiveWebSearchAccess: () => true,
}));

vi.mock('../../src/constants/webSearchBackend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/constants/webSearchBackend')>();
  return {
    ...actual,
    LIVE_WEB_SEARCH_BACKEND: 'metaso',
    liveSearchMissingKeyI18nKey: () => 'nodes.search_no_metaso_key',
    liveSearchUsesImmediateUserQuestion: () => false,
    WIKIPEDIA_LIVE_ENRICH: true,
    WIKIPEDIA_LIVE_CAP: 3,
  };
});

vi.mock('../../src/services/liveWebSearch', () => ({
  liveWebSearch: vi.fn(),
}));

vi.mock('../../src/services/filterWebpageHitsByQuestion', () => ({
  filterWebpageHitsByQuestion: vi.fn(async ({ pages }) => pages),
}));

vi.mock('../../src/services/attachWebpageOgImages', () => ({
  collectWebpageOgImages: vi.fn(async () => []),
}));

vi.mock('../../src/services/wikipediaEnrichment', () => ({
  createWikipediaEnrichmentLoader: vi.fn(),
  wikipediaWebpageHits: (res: { webpages?: unknown[] }) => res.webpages ?? [],
  wikipediaImageHits: (res: { images?: unknown[] }) => res.images ?? [],
}));

vi.mock('../../src/i18n', () => ({
  default: { language: 'zh-CN' },
}));

const searchMock = vi.mocked(liveWebSearch);
const wikiLoaderMock = vi.mocked(createWikipediaEnrichmentLoader);

describe('fulfillSearchTool Wikipedia enrich', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    searchMock.mockReset();
    wikiLoaderMock.mockReset();
    await db.nodes.add({
      id: 'ai-1',
      canvasId: 'c1',
      type: 'ai',
      content: 'ok',
      x: 0,
      y: 0,
    });
  });

  it('merges Wikipedia + Metaso pages through one filter, then spawns both', async () => {
    const load = vi.fn(async () => ({
      credits: 0,
      total: 2,
      webpages: [
        {
          title: '活着',
          link: 'https://zh.wikipedia.org/wiki/活着',
          snippet: '余华小说',
          score: '1',
          date: '',
        },
        {
          title: 'To Live (novel)',
          link: 'https://en.wikipedia.org/wiki/To_Live_(novel)',
          snippet: 'Yu Hua',
          score: '1',
          date: '',
        },
      ],
      images: [
        {
          title: '活着',
          link: 'https://zh.wikipedia.org/wiki/活着',
          imageUrl: 'https://upload.wikimedia.org/cover.jpg',
        },
      ],
    }));
    wikiLoaderMock.mockReturnValue({ load });
    searchMock.mockResolvedValue({
      credits: 0,
      total: 1,
      webpages: [{ title: '淘书网', link: 'https://taoshu.example/x', snippet: 'epub', score: '', date: '' }],
      images: [],
    });

    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      userQuestion: '介绍一下活着这本书',
      searches: [{ query: '活着', scopes: ['webpage'] }],
      apiKey: 'k',
    });

    expect(load).toHaveBeenCalled();
    const nodes = await db.nodes.toArray();
    const notes = nodes.filter((n) => n.type === 'text' && n.layout === 2);
    const imgs = nodes.filter((n) => n.type === 'image');
    expect(notes.some((n) => n.content?.includes('活着'))).toBe(true);
    expect(notes.some((n) => n.content?.includes('淘书网'))).toBe(true);
    expect(notes.some((n) => n.content?.includes('To Live'))).toBe(true);
    expect(imgs.some((n) => n.content === 'https://upload.wikimedia.org/cover.jpg')).toBe(true);
  });
});
