import {
  MINIMAX_DEFAULT_VOICE_ID,
  MINIMAX_ENGLISH_VOICE_ID,
} from '../constants/voiceWriting';
import { isChineseLocale } from './appLanguage';

export type MinimaxLanguageBoost = 'Chinese' | 'English';

export type MinimaxTtsProfile = {
  voiceId: string;
  languageBoost: MinimaxLanguageBoost;
};

/**
 * Default MiniMax voice + language_boost from the app UI language.
 * A non-empty custom voice id (settings) always wins; boost still follows UI language.
 */
export function resolveMinimaxTtsProfile(opts?: {
  customVoiceId?: string | null;
  language?: string | null;
}): MinimaxTtsProfile {
  const language = (opts?.language ?? '').trim();
  const englishUi = language.length > 0 && !isChineseLocale(language);
  const custom = (opts?.customVoiceId ?? '').trim();
  return {
    voiceId: custom || (englishUi ? MINIMAX_ENGLISH_VOICE_ID : MINIMAX_DEFAULT_VOICE_ID),
    languageBoost: englishUi ? 'English' : 'Chinese',
  };
}
