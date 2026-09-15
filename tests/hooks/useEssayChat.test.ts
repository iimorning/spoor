import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db } from '../../src/db';
import { useEssayChat } from '../../src/hooks/useEssayChat';
import { callUniversalAI } from '../../src/services/ai';
import { fulfillSearchToolFromNode } from '../../src/services/fulfillSearchTool';
import { fulfillDrawToolIntoChat } from '../../src/services/fulfillDrawTool';
import type { AIConfig } from '../../src/components/AISettingsModal';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../../src/services/fulfillSearchTool', () => ({
  fulfillSearchToolFromNode: vi.fn(async () => []),
}));

vi.mock('../../src/services/fulfillDrawTool', () => ({
  fulfillDrawToolIntoChat: vi.fn(async () => undefined),
}));

const synthesizeMock = vi.fn(async ({ draftAnswer }: { draftAnswer: string }) => draftAnswer);
vi.mock('../../src/services/synthesizeAskFromSearch', () => ({
  synthesizeAskFromSearch: (...args: unknown[]) => synthesizeMock(...args),
}));

vi.mock('../../src/lib/serverConfig', () => ({
  hasLiveWebSearchAccess: () => true,
}));

vi.mock('../../src/services/flux302', () => ({
  hasFlux302Credentials: () => true,
  imageKeysFromAiConfig: () => ({ apiKey: 'k', openrouterApiKey: '' }),
}));

vi.mock('../../src/constants/webSearchBackend', () => ({
  liveSearchMissingKeyI18nKey: () => 'nodes.search_no_metaso_key',
  liveSearchToolsPromptKey: () => 'ai.prompts.askWebToolsAvailable',
  liveSearchUsesImmediateUserQuestion: () => false,
}));

const callAi = vi.mocked(callUniversalAI);
const searchMock = vi.mocked(fulfillSearchToolFromNode);
const drawMock = vi.mocked(fulfillDrawToolIntoChat);

const aiConfig = {
  provider: 'openrouter',
  apiKey: 'k',
  metasoApiKey: 'm',
} as AIConfig;

describe('useEssayChat', () => {
  beforeEach(async () => {
    callAi.mockReset();
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text =
        '{"reply":"Looked it up.","edits":[{"find":"body","replace":"BODY"}]}\n\n```search\n{"query":"月球","scopes":["webpage"]}\n```\n```draw\n{"images":[{"title":"月","prompt":"the moon"}]}\n```';
      opts.onStreamChunk?.(text);
      return text;
    });
    searchMock.mockReset();
    drawMock.mockReset();
    synthesizeMock.mockReset();
    synthesizeMock.mockImplementation(async ({ draftAnswer }: { draftAnswer: string }) => draftAnswer);
    searchMock.mockResolvedValue([]);
    drawMock.mockResolvedValue(undefined);
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [],
    });
  });

  it('strips search/draw fences before applying JSON edits and fulfills tools', async () => {
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text =
        '{"reply":"Looked it up.","edits":[{"find":"body","replace":"BODY"}]}\n\n```search\n{"query":"月球","scopes":["webpage"]}\n```\n```draw\n{"images":[{"title":"月","prompt":"the moon"}]}\n```';
      opts.onStreamChunk?.(text);
      return text;
    });
    searchMock.mockResolvedValue([
      {
        kind: 'webpage',
        query: '月球',
        title: 'Moon',
        snippet: 'age',
        link: 'https://moon.example',
      },
    ]);

    const applyChatEdits = vi.fn(() => ({ applied: 0, missed: [] as string[] }));
    const { result } = renderHook(() =>
      useEssayChat({
        articleId: 'a1',
        articleTitle: 'T',
        messages: [],
        aiConfig,
        t: (key) => key,
        getBodyMarkdown: () => 'body',
        getSelectedText: () => '',
        applyChatEdits,
      }),
    );

    await act(async () => {
      await result.current.send('帮我查一下月亮');
    });

    expect(applyChatEdits).toHaveBeenCalledWith([{ find: 'body', replace: 'BODY' }], {
      replaceDocument: false,
    });
    expect(searchMock).toHaveBeenCalled();
    expect(searchMock.mock.calls[0]?.[0]?.placeOnCanvas).toBe(false);
    expect(drawMock).toHaveBeenCalled();
    const row = await db.articles.get('a1');
    const assistant = row?.chatMessages?.find((m) => m.role === 'assistant');
    expect(assistant?.text).toBe('Looked it up.');
    expect(assistant?.searchHits?.[0]?.link).toBe('https://moon.example');
  });

  it('does not search when the model omits search fences', async () => {
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text = '{"reply":"我先帮你查 Google Play 的上架流程。"}';
      opts.onStreamChunk?.(text);
      return text;
    });
    const { result } = renderHook(() =>
      useEssayChat({
        articleId: 'a1',
        articleTitle: 'T',
        messages: [],
        aiConfig,
        t: (key) => key,
        getBodyMarkdown: () => 'body',
        getSelectedText: () => '',
        applyChatEdits: vi.fn(() => ({ applied: 0, missed: [] as string[] })),
      }),
    );

    await act(async () => {
      await result.current.send('帮我搜一下谷歌商店的上架流程和商店页面');
    });

    expect(searchMock).not.toHaveBeenCalled();
  });

  it('does not search when the user turn has no searchable topic', async () => {
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text = '{"reply":"好的。"}';
      opts.onStreamChunk?.(text);
      return text;
    });

    const { result } = renderHook(() =>
      useEssayChat({
        articleId: 'a1',
        articleTitle: 'T',
        messages: [],
        aiConfig,
        t: (key) => key,
        getBodyMarkdown: () => 'body',
        getSelectedText: () => '',
        applyChatEdits: vi.fn(() => ({ applied: 0, missed: [] as string[] })),
      }),
    );

    await act(async () => {
      await result.current.send('你再搜一下呢');
    });

    expect(searchMock).not.toHaveBeenCalled();
  });

  it('archives the current thread when starting a new chat', async () => {
    await db.articles.put({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [
        { id: 'u1', role: 'user', text: '第一轮问题', createdAt: 1 },
        { id: 'a1', role: 'assistant', text: '第一轮回答', createdAt: 2 },
      ],
    });

    const { result } = renderHook(() =>
      useEssayChat({
        articleId: 'a1',
        articleTitle: 'T',
        messages: [
          { id: 'u1', role: 'user', text: '第一轮问题', createdAt: 1 },
          { id: 'a1', role: 'assistant', text: '第一轮回答', createdAt: 2 },
        ],
        aiConfig,
        t: (key) => key,
        getBodyMarkdown: () => 'body',
        getSelectedText: () => '',
        applyChatEdits: vi.fn(() => ({ applied: 0, missed: [] as string[] })),
      }),
    );

    await act(async () => {
      await result.current.startNewChat();
    });

    const row = await db.articles.get('a1');
    expect(row?.chatMessages).toEqual([]);
    expect(row?.chatSessionArchive?.[0]?.preview).toBe('第一轮问题');
    expect(row?.chatSessionArchive?.[0]?.messages).toHaveLength(2);
  });

  it('restores an archived session and archives the current thread', async () => {
    await db.articles.put({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [
        { id: 'u2', role: 'user', text: '当前问题', createdAt: 3 },
      ],
      chatSessionArchive: [
        {
          id: 's1',
          createdAt: 1,
          endedAt: 2,
          preview: '第一轮问题',
          messages: [
            { id: 'u1', role: 'user', text: '第一轮问题', createdAt: 1 },
            { id: 'a1', role: 'assistant', text: '第一轮回答', createdAt: 2 },
          ],
        },
      ],
    });

    const { result } = renderHook(() =>
      useEssayChat({
        articleId: 'a1',
        articleTitle: 'T',
        messages: [{ id: 'u2', role: 'user', text: '当前问题', createdAt: 3 }],
        aiConfig,
        t: (key) => key,
        getBodyMarkdown: () => 'body',
        getSelectedText: () => '',
        applyChatEdits: vi.fn(() => ({ applied: 0, missed: [] as string[] })),
      }),
    );

    await act(async () => {
      await result.current.restoreChatSession('s1');
    });

    const row = await db.articles.get('a1');
    expect(row?.chatMessages?.map((m) => m.text)).toEqual(['第一轮问题', '第一轮回答']);
    expect(row?.chatSessionArchive?.some((s) => s.id === 's1')).toBe(false);
    expect(row?.chatSessionArchive?.[0]?.preview).toBe('当前问题');
  });
});
