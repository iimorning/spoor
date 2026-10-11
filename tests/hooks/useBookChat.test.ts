import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db } from '../../src/db';
import { useBookChat } from '../../src/hooks/useBookChat';
import { callUniversalAI } from '../../src/services/ai';
import { encodeBookContent, type BookUnit } from '../../src/utils/bookPayload';
import type { BookExcerpt } from '../../src/db';
import type { AIConfig } from '../../src/components/AISettingsModal';
import i18n from '../../src/i18n';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../../src/services/fulfillSearchTool', () => ({
  fulfillSearchToolFromNode: vi.fn(async () => []),
}));

vi.mock('../../src/services/synthesizeAskFromSearch', () => ({
  synthesizeAskFromSearch: vi.fn(async ({ draftAnswer }: { draftAnswer: string }) => draftAnswer),
}));

vi.mock('../../src/lib/serverConfig', () => ({
  hasLiveWebSearchAccess: () => false,
}));

vi.mock('../../src/constants/webSearchBackend', () => ({
  liveSearchMissingKeyI18nKey: () => 'nodes.search_no_metaso_key',
  liveSearchToolsPromptKey: () => 'ai.prompts.askWebToolsAvailable',
  liveSearchUsesImmediateUserQuestion: () => false,
}));

vi.mock('../../src/utils/suggestedFollowUps', () => ({
  generateSuggestedFollowUps: vi.fn(async () => [] as string[]),
}));

const callAi = vi.mocked(callUniversalAI);

const IMAGE_DATA_URL = 'data:image/png;base64,SW5ub2NlbnRCYXNlNjRQYXlsb2Fk';
const NODE_ID = 'b1';

/** 一本书，带一张内联 base64 图片——用来验证它不会漏进 prompt。 */
const BOOK_UNIT: BookUnit = {
  title: 'Ch2',
  text: '这一章讲的是古着。年轻人开始把旧衣服当成一种表达。',
  blocks: [
    { type: 'text', text: '这一章讲的是古着。' },
    { type: 'image', src: IMAGE_DATA_URL, alt: '古着店' },
  ],
};

const EXCERPT: BookExcerpt = {
  id: 'e1',
  text: '摘抄下来的一句原文',
  source: 'book',
  unitIndex: 1,
  unitLabel: 'Ch2',
  bookTitle: '孤独消费论',
  createdAt: 1,
};

const aiConfig = { provider: 'openrouter', apiKey: 'k', metasoApiKey: 'm' } as AIConfig;
// 用真 i18n，这样断言的是插值之后的最终 prompt，而不是一个返回键名的 stub。
const t = ((key: string, opts?: Record<string, unknown>) =>
  (i18n.t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, opts)) as never;
const copy = ((key: string) => key) as never;

async function seedBook() {
  await db.nodes.add({
    id: NODE_ID,
    type: 'book',
    x: 0,
    y: 0,
    content: encodeBookContent({
      format: 'epub',
      title: '孤独消费论',
      units: [{ title: 'Ch1', text: '第一章' }, BOOK_UNIT],
    }),
    bookChatMessages: [],
  });
}

function renderChat(overrides: Partial<Parameters<typeof useBookChat>[0]> = {}) {
  return renderHook(() =>
    useBookChat({
      nodeId: NODE_ID,
      bookTitle: '孤独消费论',
      unit: BOOK_UNIT,
      unitLabel: 'Ch2',
      currentSelection: '年轻人开始把旧衣服当成一种表达',
      excerpts: [EXCERPT],
      focusedExcerpts: [] as BookExcerpt[],
      messages: [],
      aiConfig,
      t,
      copy,
      ...overrides,
    }),
  );
}

function promptSentToModel(callIndex = 0): string {
  const opts = callAi.mock.calls[callIndex]?.[0] as { messages?: Array<{ content?: string }> };
  return String(opts?.messages?.[0]?.content ?? '');
}

describe('useBookChat', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    callAi.mockReset();
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text = '{"reply":"古着在日本是一种再评价。"}';
      opts.onStreamChunk?.(text);
      return text;
    });
    await db.nodes.clear();
    await seedBook();
  });

  it('writes both the user turn and the reply onto the book node row', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('古着是什么意思？');
    });

    const row = await db.nodes.get(NODE_ID);
    expect(row?.bookChatMessages?.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(row?.bookChatMessages?.[0]?.text).toBe('古着是什么意思？');
    expect(row?.bookChatMessages?.[1]?.text).toBe('古着在日本是一种再评价。');
    // 书籍对话不该碰到 articles 那条线。
    expect(await db.articles.count()).toBe(0);
  });

  it('sends the chapter and the selection but withholds the excerpt notebook', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('古着是什么意思？');
    });

    const prompt = promptSentToModel();
    expect(prompt).toContain('这一章讲的是古着');
    expect(prompt).toContain('年轻人开始把旧衣服当成一种表达');
    expect(prompt).toContain('古着是什么意思？');
    // 摘抄本默认不上桌：只报数量，正文一块都不给。
    expect(prompt).not.toContain('摘抄下来的一句原文');
    expect(prompt).toContain('1 saved, not attached to this message');
  });

  it('tells the model how to ask for the notebook', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('古着是什么意思？');
    });

    const system = (callAi.mock.calls[0]?.[0] as { systemInstruction?: string })
      .systemInstruction;
    expect(system).toContain('```excerpts');
    expect(system).toContain('NOT attached to your messages');
  });

  it('re-asks with the whole notebook once the model asks for it', async () => {
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const first = '{"reply":"我先看看你存了什么。"}';
      opts.onStreamChunk?.(first);
      return `${first}\n\n\`\`\`excerpts\n\`\`\``;
    });
    const withNote = { ...EXCERPT, note: '这跟我衣柜里那件二手大衣对得上' };
    const { result } = renderChat({ excerpts: [withNote] });
    await act(async () => {
      await result.current.send('我之前摘的那些有联系吗？');
    });

    // 第一趟不带摘抄，第二趟才把文件夹摊开。
    expect(callAi).toHaveBeenCalledTimes(2);
    expect(promptSentToModel(0)).not.toContain('摘抄下来的一句原文');
    const opened = promptSentToModel(1);
    expect(opened).toContain('摘抄下来的一句原文');
    expect(opened).toContain('Ch2');
    // 想法单独一行、带标签。少了 noteLabel 就会退回英文 'Note'，
    // 而系统提示词在教模型认的是「My note」——两边对不上，模型认不出那行是谁写的。
    expect(opened).toContain('My note: 这跟我衣柜里那件二手大衣对得上');
    // 用户那圈围栏不该漏进回答里。
    const row = await db.nodes.get(NODE_ID);
    expect(row?.bookChatMessages?.[1]?.text).not.toContain('```excerpts');
  });

  it('does not spend a second call when the model never asks for the notebook', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('古着是什么意思？');
    });
    expect(callAi).toHaveBeenCalledTimes(1);
  });

  it('hands the model exactly the excerpts the user ticked', async () => {
    const other = { ...EXCERPT, id: 'e2', text: '另一条摘抄', note: '另一条的想法' };
    const { result } = renderChat({ excerpts: [EXCERPT, other], focusedExcerpts: [EXCERPT] });
    await act(async () => {
      await result.current.send('这条我在想什么？');
    });

    // 一趟就够：用户自己挑了，不用等模型开口要。
    expect(callAi).toHaveBeenCalledTimes(1);
    const prompt = promptSentToModel();
    expect(prompt).toContain('摘抄下来的一句原文');
    expect(prompt).not.toContain('另一条摘抄');
    expect(prompt).toContain('deliberate selection, not the whole notebook');
  });

  it('keeps the user’s ticked excerpts even when the model asks for more', async () => {
    // 用户圈定了要什么，模型再怎么要整本也不给——否则"手动挑"就白挑了。
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text = '{"reply":"我先看看你存了什么。"}';
      opts.onStreamChunk?.(text);
      return `${text}\n\n\`\`\`excerpts\n\`\`\``;
    });
    const { result } = renderChat({ focusedExcerpts: [EXCERPT] });
    await act(async () => {
      await result.current.send('这条我在想什么？');
    });

    expect(callAi).toHaveBeenCalledTimes(1);
    expect(promptSentToModel()).toContain('摘抄下来的一句原文');
  });

  it('leaves the notebook alone when the user has saved nothing', async () => {
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const first = '{"reply":"我先看看你存了什么。"}';
      opts.onStreamChunk?.(first);
      return `${first}\n\n\`\`\`excerpts\n\`\`\``;
    });
    const { result } = renderChat({ excerpts: [] });
    await act(async () => {
      await result.current.send('我之前摘的那些有联系吗？');
    });

    expect(callAi).toHaveBeenCalledTimes(1);
    expect(promptSentToModel(0)).toContain('none saved yet');
  });

  it('labels the thought in the interface language', async () => {
    await i18n.changeLanguage('zh');
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const first = '{"reply":"我先看看你存了什么。"}';
      opts.onStreamChunk?.(first);
      return `${first}\n\n\`\`\`excerpts\n\`\`\``;
    });
    const { result } = renderChat({ excerpts: [{ ...EXCERPT, note: '这跟项目对得上' }] });
    await act(async () => {
      await result.current.send('我懂了吗？');
    });
    expect(promptSentToModel(1)).toContain('我的想法: 这跟项目对得上');
  });

  it('locks the book card onto the pre-4.1 Flash', async () => {
    // 钉的是"真的发出去了"：只传 model 没用，服务端 primary 排在 requested 前面，
    // 少了 lockModel 这条改动等于没改，而那种情况下测试照样是绿的。
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('古着是什么意思？');
    });

    const opts = callAi.mock.calls[0]?.[0] as {
      config?: { model?: string };
      lockModel?: boolean;
    };
    expect(opts.config?.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(opts.lockModel).toBe(true);
  });

  it('never puts the serialized book (or its inline images) into the prompt', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('古着是什么意思？');
    });

    const prompt = promptSentToModel();
    // 整本书序列化在 node.content 里；图片是内联 base64，塞进 prompt 会撑爆请求。
    expect(prompt).not.toContain('spoor-book:v1:');
    expect(prompt).not.toContain('data:image');
    expect(prompt).not.toContain('SW5ub2NlbnRCYXNlNjRQYXlsb2Fk');
  });

  it('reports a missing provider instead of calling the model', async () => {
    const { result } = renderChat({ aiConfig: null });
    let reply: string | null = null;
    await act(async () => {
      reply = await result.current.send('有人吗');
    });

    expect(reply).toBeNull();
    expect(callAi).not.toHaveBeenCalled();
    expect(result.current.error).toBe('no_ai');
    expect((await db.nodes.get(NODE_ID))?.bookChatMessages ?? []).toEqual([]);
  });

  it('ignores an empty send', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('   ');
    });
    expect(callAi).not.toHaveBeenCalled();
  });

  it('archives the current thread when starting a new chat', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('第一个问题');
    });
    await act(async () => {
      await result.current.startNewChat();
    });

    const row = await db.nodes.get(NODE_ID);
    expect(row?.bookChatMessages).toEqual([]);
    expect(row?.bookChatSessionArchive).toHaveLength(1);
    expect(row?.bookChatSessionArchive?.[0]?.messages).toHaveLength(2);
  });

  it('restores an archived session back into the thread', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('第一个问题');
    });
    await act(async () => {
      await result.current.startNewChat();
    });
    const archived = (await db.nodes.get(NODE_ID))?.bookChatSessionArchive?.[0];

    let restored: boolean | undefined;
    await act(async () => {
      restored = await result.current.restoreChatSession(archived!.id);
    });

    expect(restored).toBe(true);
    const row = await db.nodes.get(NODE_ID);
    expect(row?.bookChatMessages?.map((m) => m.text)).toEqual([
      '第一个问题',
      '古着在日本是一种再评价。',
    ]);
  });
});
