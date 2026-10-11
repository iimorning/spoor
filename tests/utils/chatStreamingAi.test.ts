import { describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { visibleChatReplyText } from '../../src/utils/chatStreamingAi';
import { articleChatThreadStore } from '../../src/utils/chatThreadStore';

describe('visibleChatReplyText', () => {
  it('shows the reply field while JSON is still streaming', () => {
    expect(visibleChatReplyText('{"reply":"我再查一次，优先找 Google Play')).toBe(
      '我再查一次，优先找 Google Play',
    );
  });

  it('strips search fences before parsing reply', () => {
    expect(
      visibleChatReplyText(
        '{"reply":"Draft"}\n\n```search\n{"query":"Google Play","scopes":["webpage"]}\n```',
      ),
    ).toBe('Draft');
  });
});

describe('runChatStreamingCall', () => {
  it('streams early search hits and synthesis revisions', async () => {
    const { runChatStreamingCall } = await import('../../src/utils/chatStreamingAi');
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

    const result = await runChatStreamingCall({
      store: articleChatThreadStore('a1'),
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
    const { runChatStreamingCall } = await import('../../src/utils/chatStreamingAi');
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

    await runChatStreamingCall({
      store: articleChatThreadStore('a1'),
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

  it('keeps the first answer when the second pass answers with an ellipsis', async () => {
    // 模型偶尔拿「…」交差。这里是无条件盖掉上一趟的，于是用户问了个有答案的问题，
    // 收到的却是一个孤零零的省略号气泡。
    const { runChatStreamingCall } = await import('../../src/utils/chatStreamingAi');
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [
        { id: 'u1', role: 'user', text: '看看我的摘抄', createdAt: 1 },
        { id: 'a-assist', role: 'assistant', text: '', createdAt: 2 },
      ],
    });

    const result = await runChatStreamingCall({
      store: articleChatThreadStore('a1'),
      messageId: 'a-assist',
      resolvePrivateContext: () => true,
      callAi: async (_onStreamChunk, withPrivateContext) =>
        withPrivateContext ? '…' : '{"reply":"我先看看你存了什么。"}',
    });

    expect(result.reply).toBe('我先看看你存了什么。');
  });

  it('does not search when the model omits search fences', async () => {
    const { runChatStreamingCall } = await import('../../src/utils/chatStreamingAi');
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

    await runChatStreamingCall({
      store: articleChatThreadStore('a1'),
      messageId: 'a-assist',
      callAi: async () =>
        '{"reply":"我来查苹果 App Store 的官方上架流程，以及 App Store 产品页需要配置的字段和素材。"}',
      onSearchTools: searchMock,
    });

    expect(searchMock).not.toHaveBeenCalled();
  });

  it('re-asks once with the withheld context when the model asks for it', async () => {
    const { runChatStreamingCall } = await import('../../src/utils/chatStreamingAi');
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [
        { id: 'u1', role: 'user', text: '看看我的摘抄', createdAt: 1 },
        { id: 'a-assist', role: 'assistant', text: '', createdAt: 2 },
      ],
    });

    const seen: Array<boolean | undefined> = [];
    const result = await runChatStreamingCall({
      store: articleChatThreadStore('a1'),
      messageId: 'a-assist',
      resolvePrivateContext: () => true,
      callAi: async (onStreamChunk, withPrivateContext) => {
        seen.push(withPrivateContext);
        const text = withPrivateContext
          ? '{"reply":"你标的那些都指向同一个东西。"}'
          : '{"reply":"我先看看。"}\n\n```excerpts\n```';
        onStreamChunk(text);
        return text;
      },
    });

    // 第一趟不带，第二趟才带；而且只多跑一次，不来回。
    expect(seen).toEqual([undefined, true]);
    expect(result.reply).toBe('你标的那些都指向同一个东西。');
    const assistant = (await db.articles.get('a1'))?.chatMessages?.find(
      (m) => m.id === 'a-assist',
    );
    expect(assistant?.text).toBe('你标的那些都指向同一个东西。');
  });

  it('keeps the first answer when the private context cannot be opened', async () => {
    const { runChatStreamingCall } = await import('../../src/utils/chatStreamingAi');
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [
        { id: 'u1', role: 'user', text: '看看我的摘抄', createdAt: 1 },
        { id: 'a-assist', role: 'assistant', text: '', createdAt: 2 },
      ],
    });

    const calls = { n: 0 };
    const result = await runChatStreamingCall({
      store: articleChatThreadStore('a1'),
      messageId: 'a-assist',
      // 摘抄本是空的：模型要了也递不出东西，不该白跑一趟。
      resolvePrivateContext: () => false,
      callAi: async () => {
        calls.n += 1;
        return '{"reply":"我先看看。"}\n\n```excerpts\n```';
      },
    });

    expect(calls.n).toBe(1);
    expect(result.reply).toBe('我先看看。');
  });

  it('does not treat an excerpt-only reply as an empty turn', async () => {
    const { runChatStreamingCall } = await import('../../src/utils/chatStreamingAi');
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
      chatMessages: [{ id: 'a-assist', role: 'assistant', text: '', createdAt: 1 }],
    });

    const result = await runChatStreamingCall({
      store: articleChatThreadStore('a1'),
      messageId: 'a-assist',
      resolvePrivateContext: () => true,
      callAi: async (_onStreamChunk, withPrivateContext) =>
        withPrivateContext ? '{"reply":"看完再说。"}' : '```excerpts\n```',
    });

    expect(result.reply).toBe('看完再说。');
  });
});
