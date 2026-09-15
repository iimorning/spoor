import { beforeEach, describe, expect, it, vi } from 'vitest';
import { liveWebSearch } from '../../src/services/liveWebSearch';
import { metasoQa } from '../../src/services/metasoQa';
import { metasoSearch } from '../../src/services/search';

vi.mock('../../src/constants/webSearchBackend', () => ({
  LIVE_WEB_SEARCH_BACKEND: 'metaso',
  isMetasoQaLive: () => true,
}));

vi.mock('../../src/services/metasoQa', () => ({
  metasoQa: vi.fn(),
}));

vi.mock('../../src/services/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/search')>();
  return {
    ...actual,
    metasoSearch: vi.fn(),
  };
});

describe('liveWebSearch (Metaso Q&A trial)', () => {
  beforeEach(() => {
    vi.mocked(metasoQa).mockReset();
    vi.mocked(metasoSearch).mockReset();
    vi.mocked(metasoQa).mockResolvedValue({ credits: 0, total: 0, webpages: [], brief: '答' });
    vi.mocked(metasoSearch).mockResolvedValue({ credits: 0, total: 0, webpages: [] });
  });

  it('sends webpage Ask hits to Q&A, not /search', async () => {
    await liveWebSearch('谷歌最新的模型怎么样', { apiKey: 'k', size: 8 });
    expect(metasoQa).toHaveBeenCalledWith(
      '谷歌最新的模型怎么样',
      expect.objectContaining({ apiKey: 'k', size: 8 }),
    );
    expect(metasoSearch).not.toHaveBeenCalled();
  });

  it('keeps image scope on the search API', async () => {
    await liveWebSearch('猫', { apiKey: 'k', scope: 'image', size: 5 });
    expect(metasoSearch).toHaveBeenCalledWith(
      '猫',
      expect.objectContaining({ scope: 'image', size: 5 }),
    );
    expect(metasoQa).not.toHaveBeenCalled();
  });
});
