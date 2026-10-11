import { describe, it, expect } from 'vitest';
import { withBookModel } from '../../src/utils/bookAiModel';
import { OPENROUTER_BOOK_MODEL } from '../../src/constants/openrouter';
import type { AIConfig } from '../../src/components/AISettingsModal';

/** 用户自带 Key 直连 OpenRouter。 */
const ownOpenRouter = { provider: 'openrouter', apiKey: 'own-key' } as AIConfig;

describe('withBookModel', () => {
  it('pins books to the pre-4.1 Flash on OpenRouter', () => {
    const { config, lockModel } = withBookModel(ownOpenRouter);
    expect(config.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(lockModel).toBe(true);
    expect(OPENROUTER_BOOK_MODEL).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('does not change the provider it was given', () => {
    // 直连路径靠 provider 决定打哪个域名——不能替用户改。
    expect(withBookModel(ownOpenRouter).config.provider).toBe('openrouter');
  });

  it('respects a model the user picked on purpose', () => {
    const picked = { ...ownOpenRouter, model: 'some/other-model' } as AIConfig;
    expect(withBookModel(picked).config.model).toBe('some/other-model');
    expect(withBookModel(picked).lockModel).toBe(true);
  });

  it('replaces a model from a different namespace', () => {
    // `doubao-seed-2-0-lite-…` 是豆包自己的命名空间，拿去 OpenRouter 会 404。
    expect(
      withBookModel({ ...ownOpenRouter, model: 'doubao-seed-2-0-lite-260428' } as AIConfig).config
        .model,
    ).toBe('deepseek/deepseek-v4-flash-0731');
    expect(withBookModel({ ...ownOpenRouter, model: '   ' } as AIConfig).config.model).toBe(
      'deepseek/deepseek-v4-flash-0731',
    );
  });

  it('leaves direct-key setups on other providers alone', () => {
    // 用户填了自己的 Key 直连豆包/DeepSeek 官方/本地模型：那些命名空间里
    // 没有 OpenRouter 的 slug，塞过去只会 404。
    for (const provider of ['doubao', 'deepseek', 'mimo', 'minimax', 'local_llama']) {
      const input = { provider, apiKey: 'own-key' } as AIConfig;
      const { config, lockModel } = withBookModel(input);
      expect(config).toBe(input);
      expect(lockModel).toBe(false);
    }
  });

  it('does not mutate the config it was given', () => {
    const input = { ...ownOpenRouter } as AIConfig;
    withBookModel(input);
    expect(input.model).toBeUndefined();
  });
});