import { db } from '../db';
import { formatAiError } from '../services/ai';
import { AI_CARD_ERROR, markAiCardFailed } from './aiCardGeneration';
import { createThrottle } from './aiStreamThrottle';
import { extractAskToolsFromReply, searchToolSpecKey } from './askTools';
import type { SearchToolSpec } from './askTools';
import type { DrawToolSpec } from './drawTool';
import type { AskSearchHit } from './askSearchHits';
import { dedupeAskSearchHits, hitsEligibleForAskSynthesis } from './askSearchHits';
import { visibleAiReplyText } from './visibleAiReply';
import { extractCompletedThinking, extractThinkingText } from './stripThinking';
import { parseVoiceDrawIntent } from './voiceDrawIntent';
import { logSearchChain } from './searchChainLog';

export const DEFAULT_STREAM_THROTTLE_MS = 100;

export function createStreamChunkWriter(
  nodeId: string,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
  onThinking?: (thought: string) => void,
): {
  onStreamChunk: (accumulated: string) => void;
  flush: () => Promise<void>;
  cancel: () => void;
  capturedThinking: () => string;
} {
  const throttle = createThrottle((content: string) => {
    void db.nodes.update(nodeId, { content });
  }, throttleMs);
  let captured = '';

  return {
    onStreamChunk: (accumulated) => {
      // Capture order is load-bearing: keep the latest *open* think text, then
      // overwrite with closed blocks once they exist. Live is empty after prose
      // starts so it cannot clobber a completed capture; completed is empty
      // while the block is still open so it cannot clobber the live draft.
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

export type CanvasStreamingAiCallParams = {
  nodeId: string;
  callAi: (onStreamChunk: (accumulated: string) => void) => Promise<string>;
  throttleMs?: number;
  /** When the model requested illustrations, called after the prose is saved. */
  onDrawImages?: (images: DrawToolSpec[]) => void | Promise<void>;
  /**
   * When the model emits a closed ```search fence, called as soon as it appears
   * during streaming (and again at end for any specs not yet dispatched).
   */
  onSearchTools?: (
    searches: SearchToolSpec[],
    ctx: { isFinal: boolean },
  ) => void | Promise<void | AskSearchHit[]>;
  /**
   * After all searches finish, optionally revise the draft with hit snippets.
   * Only runs when synthesis-eligible hits were collected.
   */
  synthesizeFromSearch?: (input: {
    draftAnswer: string;
    hits: AskSearchHit[];
    onStreamChunk: (accumulated: string) => void;
  }) => Promise<string>;
  /** Live chain-of-thought while visible prose has not started yet. */
  onThinking?: (thought: string) => void;
  /**
   * If the model never emits a ```draw fence, still generate when this text
   * is an explicit “draw / generate an image” request.
   */
  fallbackDrawFromUser?: string;
  /**
   * Perplexity path: send this question to live search as soon as the turn starts.
   * Official Sonar usage is the user message itself — do not wait for a ```search fence.
   */
  immediateSearchQuery?: string;
  /** Fired once after all search dispatches if every attempt returned zero hits. */
  onSearchNoResults?: (detail: {
    scopes: Array<'webpage' | 'image' | 'video' | 'podcast'>;
  }) => void;
};

/** Runs AI with streaming Dexie updates; returns final text (empty if model returned blank). */
export async function runCanvasStreamingAiCall({
  nodeId,
  callAi,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
  onDrawImages,
  onSearchTools,
  onThinking,
  fallbackDrawFromUser,
  immediateSearchQuery,
  synthesizeFromSearch,
  onSearchNoResults,
}: CanvasStreamingAiCallParams): Promise<string> {
  const writer = createStreamChunkWriter(nodeId, throttleMs, onThinking);
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
    logSearchChain('1 model search fence → dispatch', {
      nodeId,
      isFinal: awaitResult,
      searches: fresh.map((s) => ({ query: s.query, scopes: s.scopes })),
    });
    const work = Promise.resolve(onSearchTools(fresh, { isFinal: awaitResult }))
      .then((hits) => {
        if (Array.isArray(hits)) collectedSearchHits.push(...hits);
      })
      .catch((err) => {
        console.error('[Spoor] search dispatch failed', err);
      });
    pendingSearchWork.push(work);
    if (awaitResult) await work;
  };

  const immediate = immediateSearchQuery?.replace(/\s+/g, ' ').trim();
  if (immediate) {
    void dispatchSearches([{ query: immediate, scopes: ['webpage'] }]);
  }

  const onStreamWithEarlySearch = (accumulated: string) => {
    writer.onStreamChunk(accumulated);
    void dispatchSearches(extractAskToolsFromReply(accumulated).searches);
  };

  try {
    const text = await callAi(onStreamWithEarlySearch);
    await writer.flush();
    const extracted = extractAskToolsFromReply(text ?? '');
    logSearchChain('0 model raw reply', {
      nodeId,
      raw: (text ?? '').slice(0, 12000),
      prose: extracted.prose.slice(0, 4000),
      searches: extracted.searches.map((s) => ({ query: s.query, scopes: s.scopes })),
    });
    let searches = extracted.searches;
    let images = extracted.images;
    if (images.length === 0 && fallbackDrawFromUser) {
      const intent = parseVoiceDrawIntent(fallbackDrawFromUser);
      const prompt = intent?.prompt.trim();
      if (prompt) {
        images = [{ title: prompt.slice(0, 40), prompt }];
      }
    }
    const cleaned =
      visibleAiReplyText(text ?? '').trim() ||
      (images.length > 0 ? images[0]!.title : '') ||
      (searches.length > 0 ? searches[0]!.query : '');
    if (!cleaned) {
      writer.cancel();
      await markAiCardFailed(nodeId, AI_CARD_ERROR.empty);
      return '';
    }
    const thinkingTrace =
      extractCompletedThinking(text ?? '') || writer.capturedThinking();
    await db.nodes.update(nodeId, {
      content: cleaned,
      aiStatus: undefined,
      aiError: undefined,
      ...(thinkingTrace ? { thinkingTrace } : {}),
    });
    if (images.length > 0) await Promise.resolve(onDrawImages?.(images));
    await dispatchSearches(searches, true);
    await Promise.all(pendingSearchWork);

    const synthesisHits = dedupeAskSearchHits(collectedSearchHits);
    if (
      onSearchNoResults &&
      dispatchedSearchKeys.size > 0 &&
      synthesisHits.length === 0
    ) {
      onSearchNoResults({ scopes: [...allRequestedScopes] });
    }

    if (
      synthesizeFromSearch &&
      synthesisHits.length > 0 &&
      hitsEligibleForAskSynthesis(synthesisHits)
    ) {
      const synthWriter = createStreamChunkWriter(nodeId, throttleMs, onThinking);
      try {
        const revised = await synthesizeFromSearch({
          draftAnswer: cleaned,
          hits: synthesisHits,
          onStreamChunk: synthWriter.onStreamChunk,
        });
        await synthWriter.flush();
        const finalText = revised.trim() || cleaned;
        if (finalText !== cleaned) {
          await db.nodes.update(nodeId, {
            content: finalText,
            aiStatus: undefined,
            aiError: undefined,
            ...(thinkingTrace ? { thinkingTrace } : {}),
          });
          return finalText;
        }
      } catch (err) {
        synthWriter.cancel();
        console.error('[Spoor] search synthesis pass failed', err);
      }
    }

    return cleaned;
  } catch (e) {
    writer.cancel();
    try {
      await markAiCardFailed(nodeId, formatAiError(e));
    } catch {
      /* node may already be gone */
    }
    throw e;
  } finally {
    onThinking?.('');
  }
}
