import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_INPUT_MODE, resolveVoiceInputMode } from '../../src/constants/voiceWriting';

describe('resolveVoiceInputMode', () => {
  it('defaults to dictation', () => {
    expect(DEFAULT_VOICE_INPUT_MODE).toBe('dictation');
    expect(resolveVoiceInputMode(undefined)).toBe('dictation');
    expect(resolveVoiceInputMode('')).toBe('dictation');
    expect(resolveVoiceInputMode('nope')).toBe('dictation');
  });

  it('keeps an explicit handsfree or dictation choice', () => {
    expect(resolveVoiceInputMode('handsfree')).toBe('handsfree');
    expect(resolveVoiceInputMode('dictation')).toBe('dictation');
  });
});
