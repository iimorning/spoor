import { describe, expect, it } from 'vitest';
import {
  LIVE_WEB_SEARCH_BACKEND,
  METASO_LIVE_MODE,
  isMetasoQaLive,
  liveSearchToolsPromptKey,
  liveSearchUsesImmediateUserQuestion,
} from '../../src/constants/webSearchBackend';

describe('webSearchBackend (current trial)', () => {
  it('uses Metaso list search for Ask live retrieval', () => {
    expect(LIVE_WEB_SEARCH_BACKEND).toBe('metaso');
    expect(METASO_LIVE_MODE).toBe('search');
    expect(isMetasoQaLive()).toBe(false);
    expect(liveSearchUsesImmediateUserQuestion()).toBe(false);
    expect(liveSearchToolsPromptKey()).toBe('ai.prompts.askWebToolsAvailable');
  });
});
