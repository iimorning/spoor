import { describe, expect, it } from 'vitest';
import {
  MINIMAX_DEFAULT_VOICE_ID,
  MINIMAX_ENGLISH_VOICE_ID,
} from '../../src/constants/voiceWriting';
import { resolveMinimaxTtsProfile } from '../../src/utils/minimaxTtsVoice';

describe('resolveMinimaxTtsProfile', () => {
  it('uses the Mandarin voice and Chinese boost for zh', () => {
    expect(resolveMinimaxTtsProfile({ language: 'zh' })).toEqual({
      voiceId: MINIMAX_DEFAULT_VOICE_ID,
      languageBoost: 'Chinese',
    });
    expect(resolveMinimaxTtsProfile({ language: 'zh-CN' }).voiceId).toBe(MINIMAX_DEFAULT_VOICE_ID);
  });

  it('uses English_CalmWoman and English boost for en', () => {
    expect(resolveMinimaxTtsProfile({ language: 'en' })).toEqual({
      voiceId: MINIMAX_ENGLISH_VOICE_ID,
      languageBoost: 'English',
    });
    expect(resolveMinimaxTtsProfile({ language: 'en-US' })).toEqual({
      voiceId: MINIMAX_ENGLISH_VOICE_ID,
      languageBoost: 'English',
    });
  });

  it('keeps a custom voice id while still boosting from UI language', () => {
    expect(
      resolveMinimaxTtsProfile({ customVoiceId: 'my-voice', language: 'en' }),
    ).toEqual({
      voiceId: 'my-voice',
      languageBoost: 'English',
    });
    expect(
      resolveMinimaxTtsProfile({ customVoiceId: '  custom  ', language: 'zh' }),
    ).toEqual({
      voiceId: 'custom',
      languageBoost: 'Chinese',
    });
  });

  it('defaults to Chinese when language is omitted', () => {
    expect(resolveMinimaxTtsProfile()).toEqual({
      voiceId: MINIMAX_DEFAULT_VOICE_ID,
      languageBoost: 'Chinese',
    });
  });
});
