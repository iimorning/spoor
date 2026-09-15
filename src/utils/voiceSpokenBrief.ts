/** Fence names the model may use for a legacy voice-only gist. */
const SPEAK_FENCE_OPEN = /```(?:speak|spoken|voice)\b/i;

/**
 * Text to read aloud from a raw model reply: the written card body, with any
 * ```speak gist fence stripped. Empty while the stream is still inside an
 * open speak-only fence with no written follow-up.
 */
export function extractVoiceSpokenText(raw: string): string {
  if (!raw) return '';
  return stripVoiceSpeakFence(raw).trim();
}

/** Remove speak fences so the canvas card never shows a leftover TTS gist. */
export function stripVoiceSpeakFence(raw: string): string {
  if (!raw) return raw;
  let s = raw.replace(/```(?:speak|spoken|voice)\s*\r?\n?([\s\S]*?)```/gi, '\n');
  const openIdx = s.search(SPEAK_FENCE_OPEN);
  if (openIdx !== -1) {
    const afterMarker = s.slice(openIdx);
    if (!afterMarker.includes('```', 3)) {
      s = s.slice(0, openIdx);
    }
  }
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Read the full written card when there is no remaining speak-fence body. */
export function spokenFallbackFromWritten(written: string): string {
  return written.trim();
}
