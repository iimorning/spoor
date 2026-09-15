import { describe, expect, it } from 'vitest';
import {
  attachOpenRouterCacheFields,
  isOpenRouterChatTarget,
  readPromptCacheUsage,
  spoorLlmSessionId,
} from '../../src/utils/openRouterPromptCache';

describe('openRouterPromptCache', () => {
  it('builds a stable session id under 256 chars', () => {
    expect(spoorLlmSessionId('ask', 'node-1')).toBe('spoor-ask-node-1');
    expect(spoorLlmSessionId('ask', 'x'.repeat(400)).length).toBeLessThanOrEqual(256);
  });

  it('detects OpenRouter chat targets', () => {
    expect(isOpenRouterChatTarget('openrouter')).toBe(true);
    expect(isOpenRouterChatTarget('custom', 'https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterChatTarget('openai', 'https://api.openai.com/v1')).toBe(false);
  });

  it('attaches session_id and prompt_cache_key', () => {
    const body = attachOpenRouterCacheFields({ model: 'x', messages: [] }, 'spoor-ask-1', {
      stream: true,
    });
    expect(body.session_id).toBe('spoor-ask-1');
    expect(body.prompt_cache_key).toBe('spoor-ask-1');
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('reads cached_tokens from usage', () => {
    expect(
      readPromptCacheUsage({
        usage: {
          prompt_tokens: 5000,
          prompt_tokens_details: { cached_tokens: 4000, cache_write_tokens: 0 },
        },
      }),
    ).toEqual({
      prompt_tokens: 5000,
      cached_tokens: 4000,
      cache_write_tokens: 0,
    });
  });
});
