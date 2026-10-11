import { createThrottle } from './aiStreamThrottle';
import { DEFAULT_STREAM_THROTTLE_MS } from './canvasStreamingAi';
import { extractAskToolsFromReply, searchToolSpecKey, type SearchToolSpec } from './askTools';
import { hasSubstantiveText } from './substantive';
import type { DrawToolSpec } from './drawTool';
import {
  dedupeAskSearchHits,
  hitsEligibleForAskSynthesis,
  mergeAskSearchHits,
  type AskSearchHit,
} from './askSearchHits';
import { parseEssayChatResponse, type ParsedEssayChatResponse } from './essayChatEdits';
import { visibleAiReplyText } from './visibleAiReply';
import type { ChatMessageLike } from './chatThreadStore';

/**
 * 流式写入只需要线程的这两项能力。`ChatThreadStore` 结构上满足它，
 * 所以长文和书籍的 store 都能直接传进来，不必把归档类型一路带下来。
 */
export interface ChatThreadWriter<TMessage extends ChatMessageLike> {
  updateMessage(
    messageId: string,
    fallback: TMessage[],
    update: (message: TMessage) => TMessage,
  ): Promise<void>;
  flush(): Promise<void>;
}

/** 会话里带联网来源的消息（长文和书籍都有这个字段）。 */
export type ChatMessageWithHits = ChatMessageLike & { searchHits?: AskSearchHit[] };

function unescapePartialJsonString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Live bubble text while the model streams the `{"reply": …}` JSON envelope.
 * 长文和书籍共用这层信封：模型把 `search` / `draw` 围栏放在 JSON 之后，
 * 所以流式期间只需要把 `reply` 字段抠出来显示。
 */
export function visibleChatReplyText(raw: string): string {
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

export function createChatStreamWriter<TMessage extends ChatMessageLike>(
  store: ChatThreadWriter<TMessage>,
  messageId: string,
  toVisible: (raw: string) => string,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
): {
  onStreamChunk: (accumulated: string) => void;
  flush: () => Promise<void>;
  cancel: () => void;
} {
  let pendingFlush: Promise<void> = Promise.resolve();
  const persistVisible = (content: string) => {
    pendingFlush = store.updateMessage(
      messageId,
      [],
      (message) => ({ ...message, text: content }) as TMessage,
    );
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
      await store.flush();
    },
    cancel: () => {
      throttle.cancel();
      pendingFlush = Promise.resolve();
    },
  };
}

export async function mergeChatMessageSearchHits<TMessage extends ChatMessageWithHits>(
  store: ChatThreadWriter<TMessage>,
  messageId: string,
  hits: AskSearchHit[],
): Promise<void> {
  if (hits.length === 0) return;
  await store.updateMessage(
    messageId,
    [],
    (message) =>
      ({
        ...message,
        searchHits: mergeAskSearchHits(message.searchHits ?? [], hits),
      }) as TMessage,
  );
}

async function finalizeChatMessage<TMessage extends ChatMessageLike>(
  store: ChatThreadWriter<TMessage>,
  messageId: string,
  text: string,
): Promise<void> {
  await store.updateMessage(
    messageId,
    [],
    (message) => ({ ...message, text }) as TMessage,
  );
}

export type ChatStreamingParams<TMessage extends ChatMessageWithHits> = {
  store: ChatThreadWriter<TMessage>;
  messageId: string;
  /**
   * 调一次模型。第二个参数为 true 表示"这一趟把扣下的私有上下文一并带上"，
   * 只有模型点名要的时候才会带着 true 被再调一次。
   */
  callAi: (onStreamChunk: (accumulated: string) => void, withPrivateContext?: boolean) => Promise<string>;
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
  /**
   * 模型点名要扣下的私有上下文（书籍对话的摘抄本）。返回 false 就到此为止；
   * 返回 true 时再问一遍，这次把摘抄一起递过去，答案就地改写。
   */
  resolvePrivateContext?: (raw: string) => boolean | Promise<boolean>;
  immediateSearchQuery?: string;
  onSearchNoResults?: (detail: {
    scopes: Array<'webpage' | 'image' | 'video' | 'podcast'>;
  }) => void;
};

export type ChatStreamingResult = {
  reply: string;
  parsed: ParsedEssayChatResponse;
  extracted: ReturnType<typeof extractAskToolsFromReply>;
  collectedSearchHits: AskSearchHit[];
};

/** Canvas-aligned streaming: early search dispatch + post-search synthesis stream. */
export async function runChatStreamingCall<TMessage extends ChatMessageWithHits>({
  store,
  messageId,
  callAi,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
  onDrawImages,
  onSearchTools,
  synthesizeFromSearch,
  resolvePrivateContext,
  immediateSearchQuery,
  onSearchNoResults,
}: ChatStreamingParams<TMessage>): Promise<ChatStreamingResult> {
  const writer = createChatStreamWriter(store, messageId, visibleChatReplyText, throttleMs);
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
          await mergeChatMessageSearchHits(store, messageId, hits);
        }
      })
      .catch((err) => console.error('[Spoor] chat search dispatch failed', err));
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
    const reply = parsed.reply.trim() || visibleChatReplyText(text ?? '').trim();
    const hasEdits = parsed.edits.length > 0 || parsed.replaceDocument;
    // 模型只吐了一个 ```excerpts 围栏、正文一个字没写——那是"我要先看摘抄"，
    // 不是空回复，第二趟补上摘抄后才有话说。
    const willOpenPrivateContext =
      Boolean(resolvePrivateContext) &&
      extracted.wantsSavedExcerpts &&
      (await resolvePrivateContext!(text ?? ''));
    if (
      !reply &&
      !hasEdits &&
      !willOpenPrivateContext &&
      extracted.searches.length === 0 &&
      extracted.images.length === 0
    ) {
      writer.cancel();
      throw new Error('empty');
    }

    await finalizeChatMessage(
      store,
      messageId,
      reply || extracted.searches[0]?.query || (willOpenPrivateContext ? '' : '…'),
    );
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
      const synthWriter = createChatStreamWriter(store, messageId, visibleAiReplyText, throttleMs);
      try {
        const revised = await synthesizeFromSearch({
          draftAnswer: finalReply || reply,
          hits: synthesisHits,
          onStreamChunk: (accumulated) => synthWriter.onStreamChunk(accumulated),
        });
        await synthWriter.flush();
        finalReply = revised.trim() || finalReply;
        if (finalReply !== reply) {
          await finalizeChatMessage(store, messageId, finalReply);
        }
      } catch (err) {
        synthWriter.cancel();
        console.error('[Spoor] chat search synthesis failed', err);
      }
    }

    /**
     * 模型点名要摘抄本：把扣下的那一份递回去，让它照着真材料重答一次。
     * 只走一趟——第二趟的 prompt 里摘抄已经摊开了，模型没有再要的理由。
     */
    if (willOpenPrivateContext && resolvePrivateContext) {
      const privateWriter = createChatStreamWriter(store, messageId, visibleChatReplyText, throttleMs);
      try {
        const revisedRaw = await callAi((accumulated) => privateWriter.onStreamChunk(accumulated), true);
        await privateWriter.flush();
        const revised = visibleChatReplyText(revisedRaw).trim();
        // 只在这一趟真的说了话时才覆盖。模型偶尔拿「…」交差，而这里是无条件盖掉
        // 上一趟——于是用户问了个有答案的问题，收到的却是一个孤零零的省略号气泡。
        if (hasSubstantiveText(revised)) {
          finalReply = revised;
          await finalizeChatMessage(store, messageId, finalReply);
        }
      } catch (err) {
        privateWriter.cancel();
        // 摘抄没递上去也要保住上一趟的答案，别把已经写好的回复抹成空白。
        console.error('[Spoor] chat private-context pass failed', err);
        await finalizeChatMessage(store, messageId, finalReply);
      }
    }

    await store.flush();

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
