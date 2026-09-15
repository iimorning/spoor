import { db } from '../db';
import type { CanvasChatMessage, CanvasPersonaThread } from '../db';
import type { ComposerSegment } from './chatComposer';
import { EMPTY_COMPOSER, normalizeComposerSegments, userTextFromSegments } from './chatComposer';
import { formatAiError } from '../services/ai';
import { createThrottle } from '../utils/aiStreamThrottle';
import { extractAskToolsFromReply, searchToolSpecKey } from '../utils/askTools';
import type { SearchToolSpec } from '../utils/askTools';
import type { DrawToolSpec } from '../utils/drawTool';
import type { AskSearchHit } from '../utils/askSearchHits';
import { dedupeAskSearchHits, hitsEligibleForAskSynthesis, mergeAskSearchHits } from '../utils/askSearchHits';
import { visibleAiReplyText } from '../utils/visibleAiReply';
import { extractCompletedThinking, extractThinkingText } from '../utils/stripThinking';
import { parseVoiceDrawIntent } from '../utils/voiceDrawIntent';
import { logSearchChain } from '../utils/searchChainLog';
import { DEFAULT_STREAM_THROTTLE_MS, createStreamChunkWriter } from './canvasStreamingAi';

export type ThreadStreamSink = {
  onChunk: (text: string) => void;
  onThinking?: (thought: string) => void;
  onComplete: (final: { text: string; thinkingTrace?: string }) => void;
  onError: (message: string) => void;
};

export function createThreadStreamWriter(
  threadId: string,
  messageId: string,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
  onThinking?: (thought: string) => void,
): {
  onStreamChunk: (accumulated: string) => void;
  flush: () => Promise<void>;
  cancel: () => void;
  capturedThinking: () => string;
} {
  const throttle = createThrottle(async (content: string) => {
    const row = await db.canvasPersonaThreads.get(threadId);
    if (!row) return;
    const messages = row.messages.map((m) =>
      m.id === messageId ? { ...m, text: content } : m,
    );
    await db.canvasPersonaThreads.put({ ...row, messages, updatedAt: Date.now() });
  }, throttleMs);
  let captured = '';

  return {
    onStreamChunk: (accumulated) => {
      const live = extractThinkingText(accumulated);
      if (live) captured = live;
      const completed = extractCompletedThinking(accumulated);
      if (completed) captured = completed;
      const visible = visibleAiReplyText(accumulated);
      if (visible.trim()) {
        onThinking?.('');
        throttle.call(visible);
        return;
      }
      onThinking?.(live);
    },
    flush: async () => {
      throttle.flush();
    },
    cancel: () => throttle.cancel(),
    capturedThinking: () => captured,
  };
}

export type PersonaStreamingParams = {
  threadId: string;
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
  onThinking?: (thought: string) => void;
  fallbackDrawFromUser?: string;
  immediateSearchQuery?: string;
  onSearchNoResults?: (detail: {
    scopes: Array<'webpage' | 'image' | 'video' | 'podcast'>;
  }) => void;
  /** Raw model accumulation (same payload V1 pushed into card TTS). */
  onStreamChunk?: (accumulated: string) => void;
};

export async function runPersonaStreamingCall({
  threadId,
  messageId,
  callAi,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
  onDrawImages,
  onSearchTools,
  onThinking,
  fallbackDrawFromUser,
  immediateSearchQuery,
  synthesizeFromSearch,
  onSearchNoResults,
  onStreamChunk,
}: PersonaStreamingParams): Promise<string> {
  const writer = createThreadStreamWriter(threadId, messageId, throttleMs, onThinking);
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
      .then((hits) => {
        if (Array.isArray(hits)) collectedSearchHits.push(...hits);
      })
      .catch((err) => console.error('[Spoor] persona search dispatch failed', err));
    pendingSearchWork.push(work);
    if (awaitResult) await work;
  };

  const immediate = immediateSearchQuery?.replace(/\s+/g, ' ').trim();
  if (immediate) void dispatchSearches([{ query: immediate, scopes: ['webpage'] }]);

  const onStreamWithEarlySearch = (accumulated: string) => {
    writer.onStreamChunk(accumulated);
    onStreamChunk?.(accumulated);
    void dispatchSearches(extractAskToolsFromReply(accumulated).searches);
  };

  try {
    const text = await callAi(onStreamWithEarlySearch);
    await writer.flush();
    const extracted = extractAskToolsFromReply(text ?? '');
    let searches = extracted.searches;
    let images = extracted.images;
    if (images.length === 0 && fallbackDrawFromUser) {
      const intent = parseVoiceDrawIntent(fallbackDrawFromUser);
      const prompt = intent?.prompt.trim();
      if (prompt) images = [{ title: prompt.slice(0, 40), prompt }];
    }
    const cleaned =
      visibleAiReplyText(text ?? '').trim() ||
      (images.length > 0 ? images[0]!.title : '') ||
      (searches.length > 0 ? searches[0]!.query : '');
    if (!cleaned) {
      writer.cancel();
      throw new Error('empty');
    }
    const thinkingTrace = extractCompletedThinking(text ?? '') || writer.capturedThinking();
    await finalizeThreadMessage(threadId, messageId, cleaned, thinkingTrace);
    if (images.length > 0) await Promise.resolve(onDrawImages?.(images));
    await dispatchSearches(searches, true);
    await Promise.all(pendingSearchWork);

    const synthesisHits = dedupeAskSearchHits(collectedSearchHits);
    if (onSearchNoResults && dispatchedSearchKeys.size > 0 && synthesisHits.length === 0) {
      onSearchNoResults({ scopes: [...allRequestedScopes] });
    }

    if (
      synthesizeFromSearch &&
      synthesisHits.length > 0 &&
      hitsEligibleForAskSynthesis(synthesisHits)
    ) {
      const synthWriter = createThreadStreamWriter(threadId, messageId, throttleMs, onThinking);
      try {
        const revised = await synthesizeFromSearch({
          draftAnswer: cleaned,
          hits: synthesisHits,
          onStreamChunk: (accumulated) => {
            synthWriter.onStreamChunk(accumulated);
            onStreamChunk?.(accumulated);
          },
        });
        await synthWriter.flush();
        const finalText = revised.trim() || cleaned;
        if (finalText !== cleaned) {
          await finalizeThreadMessage(threadId, messageId, finalText, thinkingTrace);
          return finalText;
        }
      } catch (err) {
        synthWriter.cancel();
        console.error('[Spoor] persona search synthesis failed', err);
      }
    }

    return cleaned;
  } catch (e) {
    writer.cancel();
    throw e;
  } finally {
    onThinking?.('');
  }
}

export async function mergeThreadMessageSearchHits(
  threadId: string,
  messageId: string,
  hits: AskSearchHit[],
): Promise<void> {
  if (hits.length === 0) return;
  const row = await db.canvasPersonaThreads.get(threadId);
  if (!row) return;
  const messages = row.messages.map((m) => {
    if (m.id !== messageId) return m;
    return { ...m, searchHits: mergeAskSearchHits(m.searchHits ?? [], hits) };
  });
  await db.canvasPersonaThreads.put({ ...row, messages, updatedAt: Date.now() });
}

async function finalizeThreadMessage(
  threadId: string,
  messageId: string,
  text: string,
  thinkingTrace?: string,
): Promise<void> {
  const row = await db.canvasPersonaThreads.get(threadId);
  if (!row) return;
  const messages = row.messages.map((m) =>
    m.id === messageId
      ? { ...m, text, ...(thinkingTrace ? { thinkingTrace } : {}) }
      : m,
  );
  await db.canvasPersonaThreads.put({ ...row, messages, updatedAt: Date.now() });
}

export async function appendThreadMessage(
  thread: CanvasPersonaThread,
  message: CanvasChatMessage,
): Promise<CanvasPersonaThread> {
  const next = {
    ...thread,
    messages: [...thread.messages, message],
    updatedAt: Date.now(),
  };
  await db.canvasPersonaThreads.put(next);
  return next;
}

export async function getOrCreatePersonaThread(
  canvasId: string,
  agentNodeId: string,
): Promise<CanvasPersonaThread> {
  const id = `${canvasId}:${agentNodeId}`;
  const existing = await db.canvasPersonaThreads.get(id);
  if (existing) return existing;
  const row: CanvasPersonaThread = {
    id,
    canvasId,
    agentNodeId,
    messages: [],
    updatedAt: Date.now(),
  };
  await db.canvasPersonaThreads.put(row);
  return row;
}

export async function savePersonaComposerDraft(opts: {
  canvasId: string;
  agentNodeId: string;
  draft?: string;
  composerSegments?: ComposerSegment[];
}): Promise<void> {
  const threadId = `${opts.canvasId}:${opts.agentNodeId}`;
  const segments = normalizeComposerSegments(opts.composerSegments);
  const text = opts.draft ?? userTextFromSegments(segments);
  const existing = await db.canvasPersonaThreads.get(threadId);
  const sameDraft = (existing?.composerDraft ?? '') === text;
  const sameSegments =
    JSON.stringify(existing?.composerSegments ?? EMPTY_COMPOSER) === JSON.stringify(segments);
  if (existing && sameDraft && sameSegments) return;

  if (!existing) {
    if (!text && segments.length === 1 && segments[0]?.type === 'text' && !segments[0].content) {
      return;
    }
    await db.canvasPersonaThreads.put({
      id: threadId,
      canvasId: opts.canvasId,
      agentNodeId: opts.agentNodeId,
      messages: [],
      composerDraft: text || undefined,
      composerSegments: segments,
      updatedAt: Date.now(),
    });
    return;
  }

  await db.canvasPersonaThreads.put({
    ...existing,
    composerDraft: text || undefined,
    composerSegments: segments,
    updatedAt: Date.now(),
  });
}
