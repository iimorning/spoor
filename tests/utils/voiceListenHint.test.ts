import { describe, it, expect, beforeEach } from 'vitest';
import {
  VOICE_LISTEN_HINT_KEY,
  readVoiceListenHintSeen,
  writeVoiceListenHintSeen,
} from '../../src/utils/voiceListenHint';

describe('voiceListenHint', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts unseen', () => {
    expect(readVoiceListenHintSeen()).toBe(false);
  });

  it('round-trips the seen flag', () => {
    writeVoiceListenHintSeen(true);
    expect(localStorage.getItem(VOICE_LISTEN_HINT_KEY)).toBe('true');
    expect(readVoiceListenHintSeen()).toBe(true);
    writeVoiceListenHintSeen(false);
    expect(localStorage.getItem(VOICE_LISTEN_HINT_KEY)).toBeNull();
    expect(readVoiceListenHintSeen()).toBe(false);
  });
});
