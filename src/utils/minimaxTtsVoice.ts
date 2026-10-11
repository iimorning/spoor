import {
  MINIMAX_DEFAULT_VOICE_ID,
  MINIMAX_ENGLISH_VOICE_ID,
} from '../constants/voiceWriting';
import { minimaxVoiceLanguage } from '../constants/minimaxVoices';
import { isChineseLocale } from './appLanguage';

export type MinimaxLanguageBoost = 'Chinese' | 'English';

export type MinimaxTtsProfile = {
  voiceId: string;
  languageBoost: MinimaxLanguageBoost;
};

/**
 * Default MiniMax voice + language_boost from the app UI language.
 * A non-empty custom voice id (character voice, or the global setting) always wins.
 *
 * boost 跟着**音色**走：中文界面里给角色挑了个英文音色，也得按英文念；
 * 只有音色不在我们的系统音色表里（自填 id、克隆音色）时才回落到界面语言。
 */
export function resolveMinimaxTtsProfile(opts?: {
  customVoiceId?: string | null;
  language?: string | null;
}): MinimaxTtsProfile {
  const language = (opts?.language ?? '').trim();
  const englishUi = language.length > 0 && !isChineseLocale(language);
  const custom = (opts?.customVoiceId ?? '').trim();
  const voiceId = custom || (englishUi ? MINIMAX_ENGLISH_VOICE_ID : MINIMAX_DEFAULT_VOICE_ID);
  const voiceLanguage = minimaxVoiceLanguage(voiceId);
  return {
    voiceId,
    languageBoost: (voiceLanguage ? voiceLanguage === 'en' : englishUi) ? 'English' : 'Chinese',
  };
}
