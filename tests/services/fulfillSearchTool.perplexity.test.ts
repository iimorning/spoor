import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import {
  fulfillSearchToolFromNode,
  resetPerplexityLiveSearchOnceForTests,
} from '../../src/services/fulfillSearchTool';
import { liveWebSearch } from '../../src/services/liveWebSearch';

vi.mock('../../src/lib/serverConfig', () => ({
  hasMetasoAccess: () => true,
  hasLiveWebSearchAccess: () => true,
}));

vi.mock('../../src/constants/webSearchBackend', () => ({
  LIVE_WEB_SEARCH_BACKEND: 'openrouter-perplexity',
  liveSearchMissingKeyI18nKey: () => 'nodes.search_no_openrouter_search',
  liveSearchToolsPromptKey: () => 'ai.prompts.askWebToolsAvailablePerplexity',
  liveSearchUsesImmediateUserQuestion: () => true,
}));

vi.mock('../../src/services/liveWebSearch', () => ({
  liveWebSearch: vi.fn(),
}));

const searchMock = vi.mocked(liveWebSearch);

describe('fulfillSearchToolFromNode (Perplexity)', () => {
  beforeEach(async () => {
    resetPerplexityLiveSearchOnceForTests();
    await db.nodes.clear();
    await db.edges.clear();
    searchMock.mockReset();
    await db.nodes.add({
      id: 'ai-1',
      canvasId: 'c1',
      type: 'ai',
      content: 'ok',
      x: 0,
      y: 0,
    });
    searchMock.mockResolvedValue({
      credits: 0,
      total: 1,
      webpages: [{ title: 'T', snippet: 'S', link: 'https://ex.com' }],
    });
  });

  it('sends the user question once, ignoring extra model keyword searches', async () => {
    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      userQuestion: '谷歌最新的模型怎么样',
      searches: [
        { query: 'Gemini 3.1 Pro 2026', scopes: ['webpage'] },
        { query: 'Google I/O agents', scopes: ['webpage'] },
      ],
      apiKey: 'k',
    });
    await fulfillSearchToolFromNode({
      nodeId: 'ai-1',
      userQuestion: '谷歌最新的模型怎么样',
      searches: [{ query: 'another keyword dump', scopes: ['webpage'] }],
      apiKey: 'k',
    });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith(
      '谷歌最新的模型怎么样',
      expect.objectContaining({ size: 8 }),
    );
  });
});
