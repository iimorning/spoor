/**
 * Fold provider-specific reasoning deltas into the same transcript the canvas
 * already understands (`<think>…</think>`), so live CoT can stream before
 * visible prose starts.
 *
 * DeepSeek / Doubao / MiniMax stream `delta.reasoning_content` (sometimes
 * `reasoning`) separately from `delta.content`. Hosted `ai-llm` re-emits those
 * as `{ delta, reasoning }`.
 */

const LT = '<';
const GT = '>';
const SL = '/';
const THINK_OPEN = LT + 'think' + GT;
const THINK_CLOSE = LT + SL + 'think' + GT;

const REASONING_KEYS = ['reasoning_content', 'reasoning', 'reasoning_text'] as const;

export type LlmStreamAcc = {
  reasoning: string;
  content: string;
};

export function createLlmStreamAcc(): LlmStreamAcc {
  return { reasoning: '', content: '' };
}

function asPiece(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function contentFromDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return '';
  return asPiece((delta as { content?: unknown }).content);
}

export function reasoningFromDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return '';
  const rec = delta as Record<string, unknown>;
  for (const key of REASONING_KEYS) {
    const piece = asPiece(rec[key]);
    if (piece) return piece;
  }
  return '';
}

export function llmStreamTranscript(acc: LlmStreamAcc): string {
  if (!acc.reasoning) return acc.content;
  return `${THINK_OPEN}${acc.reasoning}${THINK_CLOSE}${acc.content}`;
}

export function applyLlmStreamDelta(acc: LlmStreamAcc, delta: unknown): string {
  const reasoning = reasoningFromDelta(delta);
  const content = contentFromDelta(delta);
  if (reasoning) acc.reasoning += reasoning;
  if (content) acc.content += content;
  return llmStreamTranscript(acc);
}

/** Hosted Edge SSE: `data: {"delta":"...","reasoning":"..."}`. */
export function applyHostedSsePayload(
  acc: LlmStreamAcc,
  parsed: { delta?: unknown; reasoning?: unknown },
): string {
  const reasoning = asPiece(parsed.reasoning);
  const content = asPiece(parsed.delta);
  if (reasoning) acc.reasoning += reasoning;
  if (content) acc.content += content;
  return llmStreamTranscript(acc);
}

export function wrapMessageReasoning(content: string, reasoning: string): string {
  return llmStreamTranscript({ reasoning, content });
}
