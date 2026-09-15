import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatWebpageHitsForFilter,
  parseWebpageFilterKeepIndices,
  filterWebpageHitsByQuestion,
} from '../../src/services/filterWebpageHitsByQuestion';
import { callUniversalAI } from '../../src/services/ai';
import type { AIConfig } from '../../src/components/AISettingsModal';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

const aiMock = vi.mocked(callUniversalAI);

const config = { provider: 'deepseek', apiKey: 'k', model: 'm' } as unknown as AIConfig;
const t = ((key: string, vars?: Record<string, string>) =>
  `${key} ${JSON.stringify(vars ?? {})}`) as unknown as import('i18next').TFunction<'translation', undefined>;

describe('parseWebpageFilterKeepIndices', () => {
  it('reads web-N ids and ignores junk', () => {
    expect(parseWebpageFilterKeepIndices('{"ids":["web-0","web-2","web-9"]}', 3)).toEqual([0, 2]);
  });

  it('treats a valid empty list as drop-all', () => {
    expect(parseWebpageFilterKeepIndices('{"ids":[]}', 3)).toEqual([]);
  });

  it('returns null when JSON is missing ids', () => {
    expect(parseWebpageFilterKeepIndices('not json', 3)).toBeNull();
    expect(parseWebpageFilterKeepIndices('{"ok":true}', 3)).toBeNull();
  });
});

describe('formatWebpageHitsForFilter', () => {
  it('labels rows web-N', () => {
    const text = formatWebpageHitsForFilter([
      { title: 'A', link: 'https://a.example', snippet: 'sa', score: '', date: '' },
    ]);
    expect(text).toContain('[web-0] A');
    expect(text).toContain('https://a.example');
  });
});

describe('filterWebpageHitsByQuestion', () => {
  beforeEach(() => {
    aiMock.mockReset();
  });

  it('keeps only ids the model returns', async () => {
    aiMock.mockResolvedValue('{"ids":["web-1"]}');
    const pages = [
      { title: 'Off', link: 'https://off.example', snippet: 'x', score: '', date: '' },
      { title: 'On', link: 'https://on.example', snippet: 'y', score: '', date: '' },
    ];
    const kept = await filterWebpageHitsByQuestion({
      pages,
      userQuestion: '介绍一下我是许凉凉这本书',
      searchQuery: '我是许凉凉 书',
      config,
      t,
    });
    expect(kept).toEqual([pages[1]]);
  });

  it('fails open when the model reply cannot be parsed', async () => {
    aiMock.mockResolvedValue('sorry');
    const pages = [{ title: 'A', link: 'https://a.example', snippet: 'x', score: '', date: '' }];
    const kept = await filterWebpageHitsByQuestion({
      pages,
      userQuestion: 'hello',
      config,
      t,
    });
    expect(kept).toEqual(pages);
  });

  it('soft-keeps token matches when the model returns an empty id list', async () => {
    aiMock.mockResolvedValue('{"ids":[]}');
    const pages = [
      { title: '天气新闻', link: 'https://a.example', snippet: 'x', score: '', date: '' },
      { title: '奥威尔 1984 导读', link: 'https://b.example', snippet: '小说', score: '', date: '' },
    ];
    const kept = await filterWebpageHitsByQuestion({
      pages,
      userQuestion: '介绍一下1984这本书',
      searchQuery: '1984 书',
      config,
      t,
    });
    expect(kept.map((p) => p.title)).toEqual(['奥威尔 1984 导读']);
  });
});
