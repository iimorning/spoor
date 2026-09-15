/**
 * Strip chain-of-thought / tool-call chrome from model output so it is never shown
 * on the canvas nor read aloud by TTS.
 *
 * Supports:
 *   - DeepSeek / MiniMax-M3 thinking: <think> ... </think>
 *   - Generic:                        <thought> ... </thought>
 *   - MiniMax-M3 tool-call namespace:  ]<]minimax[>[ … <tool_call> …
 *   - Bare tool-call markers:         [<tool_call> / <tool_call>
 *
 * Streaming-safe: while the model is still inside an open thinking block, return ''.
 * Tool-call markup is cut from the first marker to end (calls are for the runtime, not the user).
 */

const LT = '<';
const GT = '>';
const SL = '/';

const THINK_OPEN = LT + 'think' + GT;
const THINK_CLOSE = LT + SL + 'think' + GT;
const THOUGHT_OPEN = LT + 'thought' + GT;
const THOUGHT_CLOSE = LT + SL + 'thought' + GT;

/** MiniMax-M3 chat-template namespace token (see their jinja: ns_token). */
const MINIMAX_NS = ']<]minimax[>[';
/** Truncated / mistyped variant sometimes seen mid-stream. */
const MINIMAX_NS_LOOSE = ']<]minimax[>';

const TOOL_CALL_MARKERS = [
  MINIMAX_NS + '<tool_call>',
  MINIMAX_NS_LOOSE + '[<tool_call>',
  MINIMAX_NS_LOOSE + '<tool_call>',
  '[<tool_call>',
  '<tool_call>',
  '```tool_call',
] as const;

function stripToolChrome(text: string): string {
  let s = text;
  // Remove namespace tokens that prefix every MiniMax tool XML tag.
  if (s.includes(MINIMAX_NS)) s = s.split(MINIMAX_NS).join('');
  if (s.includes(MINIMAX_NS_LOOSE)) s = s.split(MINIMAX_NS_LOOSE).join('');

  let cut = -1;
  for (const marker of TOOL_CALL_MARKERS) {
    const i = s.indexOf(marker);
    if (i !== -1 && (cut === -1 || i < cut)) cut = i;
  }
  if (cut !== -1) s = s.slice(0, cut);

  // Drop orphan closing tool tags if any remain.
  s = s.replace(/<\/tool_call>/g, '');
  return s;
}

export function stripThinking(text: string): string {
  if (!text) return '';

  // <think> ... </think>
  const thinkOpen = text.lastIndexOf(THINK_OPEN);
  if (thinkOpen !== -1) {
    const thinkClose = text.indexOf(THINK_CLOSE, thinkOpen);
    if (thinkClose === -1) return ''; // still thinking
    return stripThinking(text.slice(thinkClose + THINK_CLOSE.length));
  }

  // <thought> ... </thought>
  const thoughtOpen = text.lastIndexOf(THOUGHT_OPEN);
  if (thoughtOpen !== -1) {
    const thoughtClose = text.indexOf(THOUGHT_CLOSE, thoughtOpen);
    if (thoughtClose === -1) return ''; // still thinking
    return stripThinking(text.slice(thoughtClose + THOUGHT_CLOSE.length));
  }

  return stripToolChrome(text);
}

/**
 * Inner chain-of-thought while the model is still thinking (or has only
 * finished thinking and not yet emitted visible prose). Empty when there is
 * no thinking block.
 *
 * Uses the last open tag (not a sequential scan) so nested/overlapping
 * `<think>` during a stream still shows the innermost draft. Do not reuse
 * `collectThinkingBlocks` here.
 */
export function extractThinkingText(text: string): string {
  if (!text) return '';

  const fromPair = (open: string, close: string): string | null => {
    const openAt = text.lastIndexOf(open);
    if (openAt === -1) return null;
    const closeAt = text.indexOf(close, openAt);
    if (closeAt === -1) return text.slice(openAt + open.length).trim();
    return text.slice(openAt + open.length, closeAt).trim();
  };

  const think = fromPair(THINK_OPEN, THINK_CLOSE);
  if (think != null && think.length > 0 && !visibleProseStarted(text)) return think;
  const thought = fromPair(THOUGHT_OPEN, THOUGHT_CLOSE);
  if (thought != null && thought.length > 0 && !visibleProseStarted(text)) return thought;
  return '';
}

function visibleProseStarted(text: string): boolean {
  return stripThinking(text).replace(/\s+/g, '').length > 0;
}

/** Max stored chain-of-thought on an AI card (Dexie / sync payload). */
export const MAX_THINKING_TRACE_CHARS = 80_000;

function collectThinkingBlocks(text: string, open: string, close: string): string[] {
  const out: string[] = [];
  let from = 0;
  while (from < text.length) {
    const openAt = text.indexOf(open, from);
    if (openAt === -1) break;
    const innerStart = openAt + open.length;
    const closeAt = text.indexOf(close, innerStart);
    if (closeAt === -1) {
      const rest = text.slice(innerStart).trim();
      if (rest) out.push(rest);
      break;
    }
    const inner = text.slice(innerStart, closeAt).trim();
    if (inner) out.push(inner);
    from = closeAt + close.length;
  }
  return out;
}

/**
 * Thinking to keep after the visible reply exists. Unlike
 * `extractThinkingText`, this does not hide the block once prose starts,
 * and concatenates every complete (or trailing open) think/thought span.
 */
export function extractCompletedThinking(text: string): string {
  if (!text) return '';

  const think = collectThinkingBlocks(text, THINK_OPEN, THINK_CLOSE);
  const parts = think.length > 0 ? think : collectThinkingBlocks(text, THOUGHT_OPEN, THOUGHT_CLOSE);
  const joined = parts.join('\n\n').trim();
  if (!joined) return '';
  if (joined.length <= MAX_THINKING_TRACE_CHARS) return joined;
  return joined.slice(0, MAX_THINKING_TRACE_CHARS).trimEnd();
}
