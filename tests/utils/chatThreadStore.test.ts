import { describe, it, expect, beforeEach } from 'vitest';
import { db, type BookChatMessage, type EssayChatMessage } from '../../src/db';
import { articleChatThreadStore, bookChatThreadStore } from '../../src/utils/chatThreadStore';
import { buildChatSession } from '../../src/utils/chatSessionArchive';

function bookMsg(id: string, text: string): BookChatMessage {
  return { id, role: 'assistant', text, createdAt: 1 };
}

describe('bookChatThreadStore', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.nodes.add({ id: 'b1', type: 'book', x: 0, y: 0 });
  });

  it('persists the thread onto the book node row', async () => {
    const store = bookChatThreadStore('b1');
    await store.saveMessages([bookMsg('m1', '第一句')]);
    expect((await db.nodes.get('b1'))?.bookChatMessages?.[0]?.text).toBe('第一句');
  });

  it('patches one message without touching the rest', async () => {
    const store = bookChatThreadStore('b1');
    await store.saveMessages([bookMsg('m1', '甲'), bookMsg('m2', '乙')]);
    await store.updateMessage('m2', [], (m) => ({ ...m, text: '乙改' }));
    const row = await db.nodes.get('b1');
    expect(row?.bookChatMessages?.map((m) => m.text)).toEqual(['甲', '乙改']);
  });

  it('falls back to the caller copy when the row has no thread yet', async () => {
    const store = bookChatThreadStore('b1');
    const fallback = [bookMsg('m1', '占位')];
    await store.updateMessage('m1', fallback, (m) => ({ ...m, text: '落地' }));
    expect((await db.nodes.get('b1'))?.bookChatMessages?.[0]?.text).toBe('落地');
  });

  it('replaces thread and archive together', async () => {
    const store = bookChatThreadStore('b1');
    await store.saveMessages([bookMsg('m1', '旧')]);
    const archive = [buildChatSession([bookMsg('m1', '旧')], 'bcs')];
    await store.replaceThread([bookMsg('m2', '新')], archive);
    const row = await db.nodes.get('b1');
    expect(row?.bookChatMessages?.map((m) => m.text)).toEqual(['新']);
    expect(row?.bookChatSessionArchive).toHaveLength(1);
    expect(await store.loadArchive()).toHaveLength(1);
  });

  it('does not leak one book thread into another', async () => {
    await db.nodes.add({ id: 'b2', type: 'book', x: 0, y: 0 });
    await bookChatThreadStore('b1').saveMessages([bookMsg('m1', '第一本')]);
    await bookChatThreadStore('b2').saveMessages([bookMsg('m1', '第二本')]);
    expect((await db.nodes.get('b1'))?.bookChatMessages?.[0]?.text).toBe('第一本');
    expect((await db.nodes.get('b2'))?.bookChatMessages?.[0]?.text).toBe('第二本');
  });

  it('returns the same instance for the same id so writes share one queue', () => {
    expect(bookChatThreadStore('b1')).toBe(bookChatThreadStore('b1'));
    expect(bookChatThreadStore('b1')).not.toBe(bookChatThreadStore('b2'));
  });
});

describe('articleChatThreadStore', () => {
  beforeEach(async () => {
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'body',
      date: '2026',
      type: 'GEN',
      tags: [],
    });
  });

  it('still reads and writes the article row', async () => {
    const store = articleChatThreadStore('a1');
    const msg: EssayChatMessage = { id: 'm1', role: 'user', text: '改一下', createdAt: 1 };
    await store.saveMessages([msg]);
    expect((await db.articles.get('a1'))?.chatMessages?.[0]?.text).toBe('改一下');
    expect(await store.loadMessages([])).toEqual([msg]);
  });

  it('uses the caller copy when the row has no messages', async () => {
    const store = articleChatThreadStore('a1');
    const fallback: EssayChatMessage[] = [
      { id: 'm1', role: 'assistant', text: '', createdAt: 1 },
    ];
    expect(await store.loadMessages(fallback)).toEqual(fallback);
  });
});
