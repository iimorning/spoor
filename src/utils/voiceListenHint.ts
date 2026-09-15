/** First successful listen after the chime — replayed when the onboarding tour restarts. */
export const VOICE_LISTEN_HINT_KEY = 'voice_listen_hint_seen_v1';

export function readVoiceListenHintSeen(): boolean {
  try {
    return localStorage.getItem(VOICE_LISTEN_HINT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeVoiceListenHintSeen(seen: boolean): void {
  try {
    if (seen) localStorage.setItem(VOICE_LISTEN_HINT_KEY, 'true');
    else localStorage.removeItem(VOICE_LISTEN_HINT_KEY);
  } catch {
    /* private mode / quota */
  }
}
