import { db } from '../db';
import { createThrottle } from './aiStreamThrottle';
import { DEFAULT_STREAM_THROTTLE_MS } from './canvasStreamingAi';
import { extractAskToolsFromReply, searchToolSpecKey, type SearchToolSpec } from './askTools';
import type { DrawToolSpec } from './drawTool';
import {
  dedupeAskSearchHits,
  hitsEligibleForAskSynthesis,
  mergeAskSearchHits,
  type AskSearchHit,
} from './askSearchHits';
import { parseEssayChatResponse, type ParsedEssayChatResponse } from './essayChatEdits';
import { visibleAiReplyText } from './visibleAiReply';

const articleWriteQueues = new Map<string, Promise<void>>();

function enqueueArticleChatWrite(articleId: string, work: () => Promise<void>): Promise<void> {
  const prev = articleWriteQueues.get(articleId) ?? Promise.resolve();
  const next = prev.then(work).catch((err) => {
    console.error('[Spoor] essay chat write failed', err);
  });
  articleWriteQueues.set(articleId, next);
  return next;
}

export async function flushArticleChatWrites(articleId: string): Promise<void> {
  await (articleWriteQueues.get(articleId) ?? Promise.resolve());
}

function unescapePartialJsonString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** Live essay-chat bubble text while the model streams JSON (reply field only). */
export function visibleEssayChatReplyText(raw: string): string {
  const { prose } = extractAskToolsFromReply(raw);
  const trimmed = prose.trim();
  if (!trimmed) return '';
  const parsed = parseEssayChatResponse(trimmed);
  const parsedReply = parsed.reply.trim();
  if (parsedReply && !parsedReply.startsWith('{')) return parsedReply;
  const marker = '"reply"';
  const keyIdx = trimmed.indexOf(marker);
  if (keyIdx >= 0) {
    const colonQuote = trimmed.indexOf(':"', keyIdx);
    if (colonQuote >= 0) {
      let value = trimmed.slice(colonQuote + 2);
      const closeIdx = value.indexOf('"');
      if (closeIdx >= 0) value = value.slice(0, closeIdx);
      const unescaped = unescapePartialJsonString(value).trim();
      if (unescaped) return unescaped;
    }
  }
  return trimmed;
}

export function createEssayStreamWriter(
  articleId: string,
  messageId: string,
  toVisible: (raw: string) => string,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
): {
  onStreamChunk: (accumulated: string) => void;
  flush: () => Promise<void>;
  cancel: () => void;
} {
  let pendingFlush = Promise.resolve();
  const persistVisible = (content: string) => {
    pendingFlush = enqueueArticleChatWrite(articleId, async () => {
      const row = await db.articles.get(articleId);
      if (!row) return;
      const messages = (row.chatMessages ?? []).map((m) =>
        m.id === messageId ? { ...m, text: content } : m,
      );
      await db.articles.update(articleId, { chatMessages: messages });
    });
  };
  const throttle = createThrottle((content: string) => {
    void persistVisible(content);
  }, throttleMs);

  return {
    onStreamChunk: (accumulated) => {
      const visible = toVisible(accumulated);
      if (visible.trim()) throttle.call(visible);
    },
    flush: async () => {
      throttle.flush();
      await pendingFlush;
      await flushArticleChatWrites(articleId);
    },
    cancel: () => {
      throttle.cancel();
      pendingFlush = Promise.resolve();
    },
  };
}

export async function mergeEssayMessageSearchHits(
  articleId: string,
  messageId: string,
  hits: AskSearchHit[],
): Promise<void> {
  if (hits.length === 0) return;
  await enqueueArticleChatWrite(articleId, async () => {
    const row = await db.articles.get(articleId);
    if (!row) return;
    const messages = (row.chatMessages ?? []).map((m) => {
      if (m.id !== messageId) return m;
      return { ...m, searchHits: mergeAskSearchHits(m.searchHits ?? [], hits) };
    });
    await db.articles.update(articleId, { chatMessages: messages });
  });
}

async function finalizeEssayMessage(
  articleId: string,
  messageId: string,
  text: string,
  partial?: Partial<{ editCount: number; searchHits: AskSearchHit[] }>,
): Promise<void> {
  await enqueueArticleChatWrite(articleId, async () => {
    const row = await db.articles.get(articleId);
    if (!row) return;
    const messages = (row.chatMessages ?? []).map((m) =>
      m.id === messageId ? { ...m, text, ...partial } : m,
    );
    await db.articles.update(articleId, { chatMessages: messages });
  });
}

export type EssayStreamingParams = {
  articleId: string;
  messageId: string;
  callAi: (onStreamChunk: (accumulated: string) => void) => Promise<string>;
  throttleMs?: number;
  onDrawImages?: (images: DrawToolSpec[]) => void | Promise<void>;
  onSearchTools?: (
    searches: SearchToolSpec[],
    ctx: { isFinal: boolean },
  ) => void | Promise<void | AskSearchHit[]>;
  synthesizeFromSearch?: (input: {
    draftAnswer: string;
    hits: AskSearchHit[];
    onStreamChunk: (accumulated: string) => void;
  }) => Promise<string>;
  immediateSearchQuery?: string;
  onSearchNoResults?: (detail: {
    scopes: Array<'webpage' | 'image' | 'video' | 'podcast'>;
  }) => void;
};

export type EssayStreamingResult = {
  reply: string;
  parsed: ParsedEssayChatResponse;
  extracted: ReturnType<typeof extractAskToolsFromReply>;
  collectedSearchHits: AskSearchHit[];
};

/** Canvas-aligned streaming: early search dispatch + post-search synthesis stream. */
export async function runEssayStreamingCall({
  articleId,
  messageId,
  callAi,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
  onDrawImages,
  onSearchTools,
  synthesizeFromSearch,
  immediateSearchQuery,
  onSearchNoResults,
}: EssayStreamingParams): Promise<EssayStreamingResult> {
  const writer = createEssayStreamWriter(articleId, messageId, visibleEssayChatReplyText, throttleMs);
  const dispatchedSearchKeys = new Set<string>();
  const collectedSearchHits: AskSearchHit[] = [];
  const allRequestedScopes = new Set<'webpage' | 'image' | 'video' | 'podcast'>();
  const pendingSearchWork: Promise<void>[] = [];

  const dispatchSearches = async (searches: SearchToolSpec[], awaitResult = false) => {
    if (!onSearchTools || searches.length === 0) return;
    const fresh = searches.filter((spec) => {
      const key = searchToolSpecKey(spec);
      if (dispatchedSearchKeys.has(key)) return false;
      dispatchedSearchKeys.add(key);
      for (const scope of spec.scopes) allRequestedScopes.add(scope);
      return true;
    });
    if (fresh.length === 0) {
      if (awaitResult) await Promise.all(pendingSearchWork);
      return;
    }
    const work = Promise.resolve(onSearchTools(fresh, { isFinal: awaitResult }))
      .then(async (hits) => {
        if (Array.isArray(hits) && hits.length > 0) {
          collectedSearchHits.push(...hits);
          await mergeEssayMessageSearchHits(articleId, messageId, hits);
        }
      })
      .catch((err) => console.error('[Spoor] essay search dispatch failed', err));
    pendingSearchWork.push(work);
    if (awaitResult) await work;
  };

  const immediate = immediateSearchQuery?.replace(/\s+/g, ' ').trim();
  if (immediate) void dispatchSearches([{ query: immediate, scopes: ['webpage'] }]);

  const onStreamWithEarlySearch = (accumulated: string) => {
    writer.onStreamChunk(accumulated);
    void dispatchSearches(extractAskToolsFromReply(accumulated).searches);
  };

  try {
    const text = await callAi(onStreamWithEarlySearch);
    await writer.flush();
    const extracted = extractAskToolsFromReply(text ?? '');
    const parsed = parseEssayChatResponse(extracted.prose);
    const reply = parsed.reply.trim() || visibleEssayChatReplyText(text ?? '').trim();
    const hasEdits = parsed.edits.length > 0 || parsed.replaceDocument;
    if (
      !reply &&
      !hasEdits &&
      extracted.searches.length === 0 &&
      extracted.images.length === 0
    ) {
      writer.cancel();
      throw new Error('empty');
    }

    await finalizeEssayMessage(articleId, messageId, reply || extracted.searches[0]?.query || '…');
    if (extracted.images.length > 0) await Promise.resolve(onDrawImages?.(extracted.images));

    await dispatchSearches(extracted.searches, true);
    await Promise.all(pendingSearchWork);

    const synthesisHits = dedupeAskSearchHits(collectedSearchHits);
    if (onSearchNoResults && dispatchedSearchKeys.size > 0 && synthesisHits.length === 0) {
      onSearchNoResults({ scopes: [...allRequestedScopes] });
    }

    let finalReply = reply;
    if (
      synthesizeFromSearch &&
      synthesisHits.length > 0 &&
      hitsEligibleForAskSynthesis(synthesisHits)
    ) {
      const synthWriter = createEssayStreamWriter(articleId, messageId, visibleAiReplyText, throttleMs);
      try {
        const revised = await synthesizeFromSearch({
          draftAnswer: finalReply || reply,
          hits: synthesisHits,
          onStreamChunk: (accumulated) => synthWriter.onStreamChunk(accumulated),
        });
        await synthWriter.flush();
        finalReply = revised.trim() || finalReply;
        if (finalReply !== reply) {
          await finalizeEssayMessage(articleId, messageId, finalReply);
        }
      } catch (err) {
        synthWriter.cancel();
        console.error('[Spoor] essay search synthesis failed', err);
      }
    }

    await flushArticleChatWrites(articleId);

    return {
      reply: finalReply,
      parsed,
      extracted,
      collectedSearchHits: dedupeAskSearchHits(collectedSearchHits),
    };
  } catch (e) {
    writer.cancel();
    throw e;
  }
}
