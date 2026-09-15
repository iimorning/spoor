import { extractAskToolsFromReply, stripOpenAskToolFence } from './askTools';
import { stripThinking } from './stripThinking';
import { stripVoiceSpeakFence } from './voiceSpokenBrief';

/** Languages that mean “the whole reply is Markdown”, not a real code sample. */
const MARKDOWN_FENCE_LANG = /^(markdown|md|gfm|text|txt|plaintext)?$/i;

/**
 * Models often wrap a character sheet in ```markdown … ```.
 * That renders as a &lt;pre&gt; that does not wrap, so the card clips every line.
 */
export function unwrapSoleMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```([^\n`]*)\r?\n([\s\S]*)\r?\n```$/u.exec(trimmed);
  if (!match) return raw;
  const lang = (match[1] ?? '').trim();
  if (!MARKDOWN_FENCE_LANG.test(lang)) return raw;
  return match[2];
}

/** Text that should appear on the canvas (no thinking, no tool JSON, no TTS gist fence). */
export function visibleAiReplyText(raw: string): string {
  const { prose } = extractAskToolsFromReply(raw);
  return unwrapSoleMarkdownFence(
    stripThinking(stripOpenAskToolFence(stripVoiceSpeakFence(prose))),
  );
}
