import { describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { visibleEssayChatReplyText } from '../../src/utils/essayStreamingAi';

describe('visibleEssayChatReplyText', () => {
  it('shows the reply field while JSON is still streaming', () => {
    expect(visibleEssayChatReplyText('{"reply":"我再查一次，优先找 Google Play')).toBe(
      '我再查一次，优先找 Google Play',
    );
  });

  it('strips search fences before parsing reply', () => {
    expect(
      visibleEssayChatReplyText(
        '{"reply":"Draft"}\n\n```search\n{"query":"Google Play","scopes":["webpage"]}\n```',
      ),
    ).toBe('Draft');
  });
});

describe('runEssayStreamingCall', () => {
  it('streams early search hits and synthesis revisions', async () => {
    const { runEssayStreamingCall } = await import('../../src/utils/essayStreamingAi');
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [
        { id: 'u1', role: 'user', text: '搜一下', createdAt: 1 },
        { id: 'a-assist', role: 'assistant', text: '', createdAt: 2 },
      ],
    });

    const searchMock = vi.fn(async () => [
      {
        kind: 'image' as const,
        query: 'Google Play',
        title: 'Play Console',
        snippet: '',
        link: 'https://play.google.com/console',
        imageUrl: 'https://img.example/p.jpg',
      },
    ]);
    const synthMock = vi.fn(
      async ({
        onStreamChunk,
      }: {
        onStreamChunk?: (acc: string) => void;
      }) => {
        onStreamChunk?.('Expanded answer about Google Play.');
        return 'Expanded answer about Google Play.';
      },
    );

    const result = await runEssayStreamingCall({
      articleId: 'a1',
      messageId: 'a-assist',
      callAi: async (onStreamChunk) => {
        onStreamChunk('{"reply":"Short draft."}');
        return '{"reply":"Short draft."}\n\n```search\n{"query":"Google Play","scopes":["webpage","image"]}\n```';
      },
      onSearchTools: searchMock,
      synthesizeFromSearch: synthMock,
    });

    expect(searchMock).toHaveBeenCalled();
    expect(synthMock).toHaveBeenCalled();
    expect(result.reply).toBe('Expanded answer about Google Play.');
    const row = await db.articles.get('a1');
    const assistant = row?.chatMessages?.find((m) => m.id === 'a-assist');
    expect(assistant?.text).toBe('Expanded answer about Google Play.');
    expect(assistant?.searchHits?.[0]?.title).toBe('Play Console');
  });

  it('keeps search hits when a late text flush runs after merge', async () => {
    const { runEssayStreamingCall } = await import('../../src/utils/essayStreamingAi');
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [
        { id: 'u1', role: 'user', text: '搜一下', createdAt: 1 },
        { id: 'a-assist', role: 'assistant', text: '', createdAt: 2 },
      ],
    });

    const searchMock = vi.fn(async () => [
      {
        kind: 'webpage' as const,
        query: 'moon',
        title: 'Moon page',
        snippet: 'facts',
        link: 'https://moon.example',
      },
    ]);

    await runEssayStreamingCall({
      articleId: 'a1',
      messageId: 'a-assist',
      throttleMs: 50,
      callAi: async (onStreamChunk) => {
        onStreamChunk('{"reply":"Draft chunk"}');
        await new Promise((r) => setTimeout(r, 5));
        return '{"reply":"Draft chunk"}\n\n```search\n{"query":"moon","scopes":["webpage"]}\n```';
      },
      onSearchTools: searchMock,
    });

    const row = await db.articles.get('a1');
    const assistant = row?.chatMessages?.find((m) => m.id === 'a-assist');
    expect(assistant?.searchHits?.[0]?.link).toBe('https://moon.example');
  });

  it('does not search when the model omits search fences', async () => {
    const { runEssayStreamingCall } = await import('../../src/utils/essayStreamingAi');
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [
        { id: 'a-assist', role: 'assistant', text: '', createdAt: 1 },
      ],
    });
    const searchMock = vi.fn(async () => []);

    await runEssayStreamingCall({
      articleId: 'a1',
      messageId: 'a-assist',
      callAi: async () =>
        '{"reply":"我来查苹果 App Store 的官方上架流程，以及 App Store 产品页需要配置的字段和素材。"}',
      onSearchTools: searchMock,
    });

    expect(searchMock).not.toHaveBeenCalled();
  });
});
