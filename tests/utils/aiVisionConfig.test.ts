import { describe, expect, it } from 'vitest';
import { DEEPSEEK_VISION_MODEL } from '../../src/constants/deepseek';
import { OPENROUTER_DEFAULT_VISION_MODEL } from '../../src/constants/openrouter';
import { resolveChatModelForImages } from '../../src/utils/aiVisionConfig';

describe('resolveChatModelForImages', () => {
  it('switches DeepSeek text models to the native vision SKU', () => {
    expect(resolveChatModelForImages('deepseek', 'deepseek-chat')).toBe(DEEPSEEK_VISION_MODEL);
    expect(resolveChatModelForImages('deepseek', 'deepseek-v4-pro')).toBe(DEEPSEEK_VISION_MODEL);
  });

  it('keeps an explicit vision model', () => {
    expect(resolveChatModelForImages('deepseek', DEEPSEEK_VISION_MODEL)).toBe(DEEPSEEK_VISION_MODEL);
  });

  it('switches OpenRouter DeepSeek text slugs to GLM for image turns', () => {
    expect(resolveChatModelForImages('openrouter', 'deepseek/deepseek-v4-pro-0813')).toBe(
      OPENROUTER_DEFAULT_VISION_MODEL,
    );
    expect(OPENROUTER_DEFAULT_VISION_MODEL).toBe('openai/gpt-5.6-terra');
  });

  it('leaves Gemini / OpenAI model ids unchanged', () => {
    expect(resolveChatModelForImages('gemini', 'gemini-2.0-flash')).toBe('gemini-2.0-flash');
    expect(resolveChatModelForImages('openai', 'gpt-4o')).toBe('gpt-4o');
  });
});
