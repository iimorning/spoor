import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatNoteSearchHitsForModel,
  parseNoteSearchAgentAction,
  resolveNoteSearchPicks,
  runNoteSearchAgent,
  type NoteSearchCatalogHit,
} from '../../src/services/noteSearchAgent';
import { callUniversalAI } from '../../src/services/ai';
import { metasoSearch } from '../../src/services/search';
import type { AIConfig } from '../../src/components/AISettingsModal';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

vi.mock('../../src/services/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/search')>();
  return {
    ...actual,
    metasoSearch: vi.fn(),
  };
});

const t = ((key: string, opts?: Record<string, string>) => {
  if (key === 'ai.prompts.noteSearchAgentUser') {
    return `NOTE:${opts?.note ?? ''}|LINKED:${opts?.linked ?? ''}`;
  }
  return key;
}) as unknown as import('i18next').TFunction<'translation', undefined>;

const aiConfig: AIConfig = {
  provider: 'gemini',
  apiKey: 'k',
  baseUrl: '',
  model: 'm',
  metasoApiKey: 'mk',
};

function hit(id: string, kind: NoteSearchCatalogHit['kind']): NoteSearchCatalogHit {
  return {
    id,
    kind,
    title: id,
    snippet: '',
    raw: { title: id, link: `https://ex/${id}`, snippet: '' },
  };
}

describe('parseNoteSearchAgentAction', () => {
  it('parses a search tool call', () => {
    expect(parseNoteSearchAgentAction('{"action":"search","scope":"webpage","query":"日本 教师"}')).toEqual({
      type: 'search',
      scope: 'webpage',
      query: '日本 教师',
    });
  });

  it('parses done with ids', () => {
    expect(parseNoteSearchAgentAction('{"action":"done","ids":["web-0","img-1"]}')).toEqual({
      type: 'done',
      hitIds: ['web-0', 'img-1'],
    });
  });

  it('returns null for prose', () => {
    expect(parseNoteSearchAgentAction('I will search now')).toBeNull();
  });
});

describe('resolveNoteSearchPicks', () => {
  it('keeps catalog hits in request order and drops unknown ids', () => {
    const catalog = new Map([
      ['web-0', hit('web-0', 'webpage')],
      ['web-1', hit('web-1', 'webpage')],
      ['img-0', hit('img-0', 'image')],
    ]);
    const picks = resolveNoteSearchPicks(catalog, ['img-0', 'nope', 'web-1', 'img-0']);
    expect(picks.map((p) => p.id)).toEqual(['img-0', 'web-1']);
  });

  it('caps videos and podcasts separately', () => {
    const catalog = new Map([
      ['vid-0', hit('vid-0', 'video')],
      ['vid-1', hit('vid-1', 'video')],
      ['vid-2', hit('vid-2', 'video')],
      ['vid-3', hit('vid-3', 'video')],
      ['pod-0', hit('pod-0', 'podcast')],
      ['pod-1', hit('pod-1', 'podcast')],
      ['pod-2', hit('pod-2', 'podcast')],
      ['pod-3', hit('pod-3', 'podcast')],
    ]);
    const picks = resolveNoteSearchPicks(catalog, [
      'vid-0', 'vid-1', 'vid-2', 'vid-3', 'pod-0', 'pod-1', 'pod-2', 'pod-3',
    ]);
    expect(picks.map((p) => p.id)).toEqual(['vid-0', 'vid-1', 'vid-2', 'pod-0', 'pod-1', 'pod-2']);
  });
});

describe('formatNoteSearchHitsForModel', () => {
  it('lists ids the model must cite', () => {
    const text = formatNoteSearchHitsForModel('webpage', '教师', [
      hit('web-0', 'webpage'),
    ]);
    expect(text).toContain('[web-0]');
    expect(text).toContain('webpage search');
  });
});

describe('runNoteSearchAgent', () => {
  beforeEach(() => {
    vi.mocked(callUniversalAI).mockReset();
    vi.mocked(metasoSearch).mockReset();
  });

  it('searches, then only cards ids the model selected after reading hits', async () => {
    vi.mocked(callUniversalAI)
      .mockResolvedValueOnce(JSON.stringify({ action: 'search', scope: 'webpage', query: '日本 1980 教师' }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'done', ids: ['web-1'] }));
    vi.mocked(metasoSearch).mockImplementation(async (_q, opts) => {
      if (opts?.scope === 'image') {
        return { credits: 0, total: 0, webpages: [], images: [] };
      }
      return {
        credits: 0,
        total: 2,
        webpages: [
          { title: '无关招聘', link: 'https://a.example', snippet: '招教师', score: '1', date: '' },
          { title: '1980年代日本教师', link: 'https://b.example', snippet: '社会地位', score: '1', date: '' },
        ],
      };
    });

    const picks = await runNoteSearchAgent({
      noteText: '教师被尊称为先生',
      linkedContext: '1980年代日本',
      metasoApiKey: 'mk',
      aiConfig,
      t,
    });

    expect(metasoSearch).toHaveBeenCalledWith('日本 1980 教师', expect.objectContaining({ scope: 'webpage' }));
    expect(metasoSearch).toHaveBeenCalledWith('日本 1980 教师', expect.objectContaining({ scope: 'image' }));
    expect(metasoSearch).toHaveBeenCalledWith('日本 1980 教师', expect.objectContaining({ scope: 'video' }));
    expect(metasoSearch).toHaveBeenCalledWith('日本 1980 教师', expect.objectContaining({ scope: 'podcast' }));
    expect(picks).toHaveLength(1);
    expect(picks[0]?.id).toBe('web-1');
    expect((picks[0]?.raw as { title?: string }).title).toBe('1980年代日本教师');
    expect(vi.mocked(callUniversalAI).mock.calls.length).toBe(2);
    const secondMsgs = vi.mocked(callUniversalAI).mock.calls[1]![0].messages ?? [];
    const tool = secondMsgs.find((m) => m.role === 'user' && String(m.content).includes('[web-1]'));
    expect(tool).toBeTruthy();
  });

  it('webpage search also returns images, and nudges if done omits them', async () => {
    vi.mocked(callUniversalAI)
      .mockResolvedValueOnce(JSON.stringify({ action: 'search', scope: 'webpage', query: '古着' }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'done', ids: ['web-0'] }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'done', ids: ['web-0', 'img-0'] }));
    vi.mocked(metasoSearch).mockImplementation(async (_q, opts) => {
      if (opts?.scope === 'image') {
        return {
          credits: 0,
          total: 1,
          webpages: [],
          images: [{ title: '古着店面', imageUrl: 'https://img.example/a.jpg', link: 'https://ex/a' }],
        };
      }
      return {
        credits: 0,
        total: 1,
        webpages: [{ title: '古着词源', link: 'https://ex/w', snippet: '定义', score: '1', date: '' }],
      };
    });

    const picks = await runNoteSearchAgent({
      noteText: '古着',
      linkedContext: '(none)',
      metasoApiKey: 'mk',
      aiConfig,
      t,
    });

    expect(picks.map((p) => p.id).sort()).toEqual(['img-0', 'web-0']);
    expect(vi.mocked(callUniversalAI).mock.calls.length).toBe(3);
    const nudge = vi.mocked(callUniversalAI).mock.calls[2]![0].messages ?? [];
    expect(nudge.some((m) => m.role === 'user' && String(m.content).includes('noteSearchAgentNeedMedia'))).toBe(true);
  });

  it('auto-attaches catalog images if done still omits them after the nudge', async () => {
    vi.mocked(callUniversalAI)
      .mockResolvedValueOnce(JSON.stringify({ action: 'search', scope: 'webpage', query: '古着' }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'done', ids: ['web-0'] }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'done', ids: ['web-0'] }));
    vi.mocked(metasoSearch).mockImplementation(async (_q, opts) => {
      if (opts?.scope === 'image') {
        return {
          credits: 0,
          total: 1,
          webpages: [],
          images: [{ title: '古着店面', imageUrl: 'https://img.example/a.jpg', link: 'https://ex/a' }],
        };
      }
      return {
        credits: 0,
        total: 1,
        webpages: [{ title: '古着词源', link: 'https://ex/w', snippet: '定义', score: '1', date: '' }],
      };
    });

    const picks = await runNoteSearchAgent({
      noteText: '古着',
      linkedContext: '(none)',
      metasoApiKey: 'mk',
      aiConfig,
      t,
    });

    expect(picks.map((p) => p.id).sort()).toEqual(['img-0', 'web-0']);
  });

  it('fans out image/video/podcast and keeps only the ids the model judged best', async () => {
    vi.mocked(callUniversalAI)
      .mockResolvedValueOnce(JSON.stringify({ action: 'search', query: '古着 历史' }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'done', ids: ['img-0', 'vid-0', 'pod-1'] }));
    vi.mocked(metasoSearch).mockImplementation(async (_q, opts) => {
      if (opts?.scope === 'image') {
        return {
          credits: 0,
          total: 2,
          webpages: [],
          images: [
            { title: '古着店面', imageUrl: 'https://img.example/a.jpg', link: 'https://ex/a' },
            { title: '无关风景', imageUrl: 'https://img.example/b.jpg', link: 'https://ex/b' },
          ],
        };
      }
      if (opts?.scope === 'video') {
        return {
          credits: 0,
          total: 2,
          webpages: [],
          videos: [
            { title: '古着文化纪录片', link: 'https://v.example/1', snippet: '历史' },
            { title: '开箱评测', link: 'https://v.example/2', snippet: '跑题' },
          ],
        };
      }
      if (opts?.scope === 'podcast') {
        return {
          credits: 0,
          total: 2,
          webpages: [],
          podcasts: [
            { title: '时尚闲聊', link: 'https://p.example/1', snippet: '跑题' },
            { title: '古着收藏访谈', link: 'https://p.example/2', snippet: '收藏史' },
          ],
        };
      }
      return {
        credits: 0,
        total: 1,
        webpages: [{ title: '古着词源', link: 'https://ex/w', snippet: '定义', score: '1', date: '' }],
      };
    });

    const picks = await runNoteSearchAgent({
      noteText: '古着',
      linkedContext: '(none)',
      metasoApiKey: 'mk',
      aiConfig,
      t,
    });

    expect(picks.map((p) => p.id)).toEqual(['img-0', 'vid-0', 'pod-1']);
    expect(picks.map((p) => p.kind)).toEqual(['image', 'video', 'podcast']);
    expect(vi.mocked(callUniversalAI).mock.calls.length).toBe(2);
  });
});
