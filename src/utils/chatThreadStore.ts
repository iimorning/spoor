import {
  db,
  type BookChatMessage,
  type BookChatSession,
  type EssayChatMessage,
  type EssayChatSession,
} from '../db';
import type { ChatSessionLike } from './chatSessionArchive';

/** 面板与流式写入只依赖这几个字段，长文/书籍各自的消息类型都是它的超集。 */
export interface ChatMessageLike {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

/**
 * 一个对话线程的存储端口。长文把线程存在文章行上，书籍存在画布卡片行上。
 *
 * 写入按 `id` 在 store 内部排队：流式的节流写和收尾的整体写不会互相覆盖。
 * 同一 id 复用同一实例（见下面的 `articleChatThreadStore` / `bookChatThreadStore`），
 * 所以两个组件拿到的是同一条队列。
 *
 * **不要在 `updateMessage` / `replaceThread` 的回调里调用 `loadMessages` 或 `flush`**：
 * 它们会等队列尾，而当时队列尾就是当前回调自己，会死锁。回调里一律只用 `readRow`。
 */
export interface ChatThreadStore<
  TMessage extends ChatMessageLike,
  TSession extends ChatSessionLike<TMessage>,
> {
  readonly id: string;
  saveMessages(messages: TMessage[]): Promise<void>;
  /** 读回当前线程；行缺失或线程为空时用 `fallback`。 */
  loadMessages(fallback: TMessage[]): Promise<TMessage[]>;
  /** 按 id 打补丁；排在它前面的写入此时都已落地。 */
  updateMessage(
    messageId: string,
    fallback: TMessage[],
    update: (message: TMessage) => TMessage,
  ): Promise<void>;
  loadArchive(): Promise<TSession[]>;
  /** 线程与归档一起写（新建会话 / 恢复历史会话）。 */
  replaceThread(messages: TMessage[], archive: TSession[]): Promise<void>;
  /** 等这个线程所有在途写入落地。 */
  flush(): Promise<void>;
}

const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(storeId: string, work: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(storeId) ?? Promise.resolve();
  const next = prev.then(work).catch((err) => {
    console.error('[Spoor] chat thread write failed', err);
  });
  writeQueues.set(storeId, next);
  return next;
}

async function flushWrites(storeId: string): Promise<void> {
  await (writeQueues.get(storeId) ?? Promise.resolve());
}

interface ThreadRows<TMessage, TSession> {
  messages: TMessage[];
  archive: TSession[];
}

function makeChatThreadStore<
  TMessage extends ChatMessageLike,
  TSession extends ChatSessionLike<TMessage>,
>(options: {
  id: string;
  readRow: () => Promise<ThreadRows<TMessage, TSession>>;
  writeMessages: (messages: TMessage[]) => Promise<void>;
  writeThread: (messages: TMessage[], archive: TSession[]) => Promise<void>;
}): ChatThreadStore<TMessage, TSession> {
  const { id } = options;
  return {
    id,
    saveMessages: (messages) =>
      enqueueWrite(id, async () => {
        await options.writeMessages(messages);
      }),
    loadMessages: async (fallback) => {
      await flushWrites(id);
      const rows = await options.readRow();
      return rows.messages.length > 0 ? rows.messages : fallback;
    },
    updateMessage: (messageId, fallback, update) =>
      enqueueWrite(id, async () => {
        const rows = await options.readRow();
        const current = rows.messages.length > 0 ? rows.messages : fallback;
        await options.writeMessages(current.map((m) => (m.id === messageId ? update(m) : m)));
      }),
    loadArchive: async () => {
      await flushWrites(id);
      return (await options.readRow()).archive;
    },
    replaceThread: (messages, archive) =>
      enqueueWrite(id, async () => {
        await options.writeThread(messages, archive);
      }),
    flush: () => flushWrites(id),
  };
}

const storeCache = new Map<string, unknown>();

function cachedStore<T>(key: string, build: () => T): T {
  const existing = storeCache.get(key);
  if (existing) return existing as T;
  const store = build();
  storeCache.set(key, store);
  return store;
}

export type ArticleChatThreadStore = ChatThreadStore<EssayChatMessage, EssayChatSession>;

/** 长文侧：线程存在 `db.articles` 行上。 */
export function articleChatThreadStore(articleId: string): ArticleChatThreadStore {
  const key = `article:${articleId}`;
  return cachedStore(key, () =>
    makeChatThreadStore<EssayChatMessage, EssayChatSession>({
      id: key,
      readRow: async () => {
        const row = await db.articles.get(articleId);
        return {
          messages: row?.chatMessages ?? [],
          archive: row?.chatSessionArchive ?? [],
        };
      },
      writeMessages: async (messages) => {
        await db.articles.update(articleId, { chatMessages: messages });
      },
      writeThread: async (messages, archive) => {
        await db.articles.update(articleId, {
          chatMessages: messages,
          chatSessionArchive: archive,
        });
      },
    }),
  );
}

export type BookChatThreadStore = ChatThreadStore<BookChatMessage, BookChatSession>;

/** 书籍侧：线程存在画布卡片行上。 */
export function bookChatThreadStore(nodeId: string): BookChatThreadStore {
  const key = `node:${nodeId}`;
  return cachedStore(key, () =>
    makeChatThreadStore<BookChatMessage, BookChatSession>({
      id: key,
      readRow: async () => {
        const row = await db.nodes.get(nodeId);
        return {
          messages: row?.bookChatMessages ?? [],
          archive: row?.bookChatSessionArchive ?? [],
        };
      },
      writeMessages: async (messages) => {
        await db.nodes.update(nodeId, { bookChatMessages: messages });
      },
      writeThread: async (messages, archive) => {
        await db.nodes.update(nodeId, {
          bookChatMessages: messages,
          bookChatSessionArchive: archive,
        });
      },
    }),
  );
}
