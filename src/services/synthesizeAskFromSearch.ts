import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import {
  formatAskSearchHitsForModel,
  hitsEligibleForAskSynthesis,
  type AskSearchHit,
} from '../utils/askSearchHits';
import { visibleAiReplyText } from '../utils/visibleAiReply';

/**
 * Second-pass LLM: revise the pre-search draft using Metaso title/snippet catalog.
 */
export async function synthesizeAskFromSearch(options: {
  config: AIConfig;
  t: TFunction<'translation', undefined>;
  userQuestion: string;
  draftAnswer: string;
  hits: AskSearchHit[];
  onStreamChunk?: (accumulated: string) => void;
  sessionId?: string;
}): Promise<string> {
  const draft = options.draftAnswer.trim();
  if (!draft || !hitsEligibleForAskSynthesis(options.hits)) return draft;

  const catalog = formatAskSearchHitsForModel(options.hits);
  if (!catalog.trim()) return draft;

  try {
    const raw = await callUniversalAI({
      config: options.config,
      systemInstruction: combineSystemParts(
        getLocaleDirective(),
        options.t('ai.prompts.askSearchSynthesisSystem'),
      ),
      prompt: options.t('ai.prompts.askSearchSynthesisUser', {
        question: options.userQuestion.trim().slice(0, 2000),
        draft: draft.slice(0, 8000),
        catalog,
      }),
      temperature: 0.35,
      topP: 0.5,
      onStreamChunk: options.onStreamChunk,
      sessionId: options.sessionId,
    });
    const revised = visibleAiReplyText(raw ?? '').trim();
    return revised || draft;
  } catch (err) {
    console.error('[Spoor] ask search synthesis failed', err);
    return draft;
  }
}
