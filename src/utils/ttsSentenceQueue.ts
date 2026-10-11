import { openMinimaxTtsStream, type MinimaxTtsStream } from '../services/minimaxTtsStream';
import { stripThinking } from './stripThinking';
import { compactTtsText } from './ttsFollowAlongDom';

const SENTENCE_END = /([。！？!?；;\n]+)/;

export type TtsQueueConfig = {
  apiKey: string;
  model?: string;
  voiceId?: string;
  language?: string;
  /** 顺带把合成出来的音频留一份（试听缓存用），见 {@link MinimaxTtsStream.takeRecordedWavBytes}。 */
  recordAudio?: boolean;
  onSpeakingChange?: (speaking: boolean) => void;
  /** Current sentence whose audio is playing; `null` when idle. */
  onActiveSentenceChange?: (sentence: string | null) => void;
  onError?: (message: string) => void;
};

/**
 * Find the longest common prefix of `a` and `b`.
 * Cheaper than computing suffix matches and works for the monotonic case (which is 99% of
 * streaming providers). Returns 0 if there's no shared prefix at all.
 */
function longestCommonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * Dedupe anchor length between two accumulated strings. Returns the number of leading chars
 * of `next` that we have already accounted for (as queue entries or carry).
 */
function dedupeLength(prev: string, next: string): number {
  const lcp = longestCommonPrefix(prev, next);
  if (lcp >= prev.length) {
    return lcp;
  }
  // Provider corrections are not safe to splice into already queued speech. The caller can
  // still use sentence-level dedupe for a later stable accumulated response.
  return 0;
}

function cutSentences(input: string): { sentences: string[]; carry: string } {
  const out: string[] = [];
  let carry = '';
  const parts = input.split(SENTENCE_END);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (!part) continue;
    if (SENTENCE_END.test(part)) continue;
    const delim = parts[i + 1];
    if (delim && SENTENCE_END.test(delim)) {
      out.push(part + delim);
      i++;
    } else if (i === parts.length - 1) {
      carry = part;
    } else {
      out.push(part);
    }
  }
  return { sentences: out, carry };
}

/**
 * Buffer streaming text, cut on sentence boundaries, synthesize & play in order.
 *
 * The provider's accumulated text is mostly monotonic but may be re-normalized (leading
 * whitespace, mid-stream corrections). We dedupe by anchoring against `seenConcat + carry`
 * via a longest-common-prefix with a tail-overlap fallback, then drop any sentence that
 * already appears at the tail of `seenConcat` so an erroneously re-delivered tail is skipped.
 */
export function createTtsSentenceQueue(config: TtsQueueConfig) {
  // The full cleaned accumulated text we have already processed, WITH original spacing.
  // Used as the LCP dedup anchor so inter-sentence spaces don't break alignment.
  let consumed = '';
  let carry = '';
  // Every sentence text we've ever enqueued — a sentence already spoken must never be
  // spoken again, regardless of where it sits in the stream.
  const spoken = new Set<string>();
  let closed = false;
  let speaking = false;
  const pendingTexts: string[] = [];
  let stream: MinimaxTtsStream | null = null;
  let streamOpening: Promise<void> | null = null;
  let finishRequested = false;

  const setSpeaking = (v: boolean) => {
    if (speaking === v) return;
    speaking = v;
    config.onSpeakingChange?.(v);
  };

  const ensureStream = () => {
    if (streamOpening) return streamOpening;
    streamOpening = openMinimaxTtsStream({
      apiKey: config.apiKey,
      model: config.model,
      voiceId: config.voiceId,
      language: config.language,
      recordAudio: config.recordAudio,
      onSpeakingChange: setSpeaking,
      onActiveTextChange: config.onActiveSentenceChange,
      onError: config.onError,
    })
      .then((opened) => {
        if (closed) {
          opened.stop();
          return;
        }
        stream = opened;
        while (pendingTexts.length > 0) stream.enqueueText(pendingTexts.shift()!);
        if (finishRequested) stream.finish();
      })
      .catch((e) => {
        // Drop the failed handle so a later sentence can open a fresh socket.
        // A warmup-only failure (no text yet) stays silent — the first real
        // sentence retries instead of alerting during "thinking".
        streamOpening = null;
        stream = null;
        if (closed) return;
        if (pendingTexts.length > 0 || finishRequested) {
          config.onError?.(e instanceof Error ? e.message : String(e));
        }
      });
    return streamOpening;
  };

  const enqueueSentence = (sentence: string) => {
    const t = sentence.trim();
    if (!t || closed) return;
    // Table separators / heading-only hashes compact to empty — do not speak them.
    if (!compactTtsText(t)) return;
    if (spoken.has(t)) return; // never repeat a sentence already spoken
    spoken.add(t);
    if (stream) stream.enqueueText(t);
    else {
      pendingTexts.push(t);
      void ensureStream();
    }
  };

  return {
    /** Open MiniMax (token + WebSocket + task_start) before the first sentence. */
    warmup() {
      if (closed) return;
      void ensureStream();
    },
    pushAccumulatedText(accumulated: string) {
      if (closed) return;
      // Never read chain-of-thought blocks aloud.
      const cleaned = stripThinking(accumulated);
      // Providers often normalize streaming boundaries with leading/trailing whitespace.
      // Trim both sides before matching so a ` 你好。` (leading space) dedupes correctly.
      const trimmed = cleaned.replace(/^\s+/u, '');
      if (!trimmed) return;
      const overlap = dedupeLength(consumed.replace(/\s+$/u, ''), trimmed);
      const newPart = trimmed.slice(overlap);
      // `consumed` mirrors the real streamed text (with spacing) so the next LCP aligns.
      consumed = trimmed;

      const { sentences, carry: nextCarry } = cutSentences(carry + newPart);
      for (const s of sentences) {
        enqueueSentence(s);
      }
      carry = nextCarry;
    },
    flush() {
      const t = carry.trim();
      if (t) {
        enqueueSentence(t);
        carry = '';
      }
      finishRequested = true;
      if (stream) stream.finish();
      else void ensureStream();
    },
    async waitUntilIdle() {
      await ensureStream();
      await stream?.waitUntilIdle();
    },
    stop() {
      closed = true;
      pendingTexts.length = 0;
      stream?.stop();
      setSpeaking(false);
      config.onActiveSentenceChange?.(null);
    },
    /** 开了 recordAudio 才有内容（WAV 字节）；取走后不重复给（缓存写一次就够）。 */
    takeRecordedWavBytes(): Uint8Array | null {
      if (!stream) return null;
      try {
        return stream.takeRecordedWavBytes?.() ?? null;
      } catch {
        return null;
      }
    },
  };
}

type WholeTextQueue = Pick<
  ReturnType<typeof createTtsSentenceQueue>,
  'warmup' | 'pushAccumulatedText' | 'flush' | 'waitUntilIdle' | 'stop'
>;

/**
 * 把**一整段已经写完的文本**念完：喂进去 → 冲掉结尾那半句 → 等最后一句放完 → 关流。
 *
 * 这几步必须齐全，少一步都会出问题：
 * - 没有 flush，结尾没有终止标点的半句永远不会念（它还留在 carry 里），
 *   而且流收不到"没有更多文本了"的信号；
 * - 没有 stop，WebSocket 会一直等着下一句，空闲超时后（约 120 秒）弹出合成失败。
 *
 * 返回是否正常念完；`isStillCurrent` 用来判断这次朗读是否已被"停止"或新的一次朗读接管，
 * 被接管时不再关流（那个队列已经不归它管了）。
 */
export async function speakWholeText(
  tts: WholeTextQueue,
  text: string,
  options?: { isStillCurrent?: () => boolean },
): Promise<boolean> {
  tts.warmup();
  tts.pushAccumulatedText(text);
  tts.flush();
  await tts.waitUntilIdle();
  if (options?.isStillCurrent && !options.isStillCurrent()) return false;
  tts.stop();
  return true;
}
