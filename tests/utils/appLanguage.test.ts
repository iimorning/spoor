import { describe, expect, it } from 'vitest';
import {
  isChineseLocale,
  resolveInitialLanguage,
} from '../../src/utils/appLanguage';

describe('isChineseLocale', () => {
  it('matches zh and regional Chinese tags', () => {
    expect(isChineseLocale('zh')).toBe(true);
    expect(isChineseLocale('zh-CN')).toBe(true);
    expect(isChineseLocale('zh-TW')).toBe(true);
    expect(isChineseLocale('zh-HK')).toBe(true);
    expect(isChineseLocale('zh_CN')).toBe(true);
  });

  it('rejects other languages', () => {
    expect(isChineseLocale('en')).toBe(false);
    expect(isChineseLocale('en-US')).toBe(false);
    expect(isChineseLocale('ja')).toBe(false);
  });
});

describe('resolveInitialLanguage', () => {
  it('prefers a saved en/zh choice over the browser', () => {
    expect(resolveInitialLanguage('en', ['zh-CN'])).toBe('en');
    expect(resolveInitialLanguage('zh', ['en-US'])).toBe('zh');
  });

  it('defaults to zh when the browser list includes a Chinese locale', () => {
    expect(resolveInitialLanguage(null, ['zh-CN'])).toBe('zh');
    expect(resolveInitialLanguage(null, ['en-US', 'zh-TW'])).toBe('zh');
    expect(resolveInitialLanguage('', ['zh'])).toBe('zh');
  });

  it('defaults to en when nothing is saved and the browser is not Chinese', () => {
    expect(resolveInitialLanguage(null, [])).toBe('en');
    expect(resolveInitialLanguage(null, ['en-US', 'en'])).toBe('en');
    expect(resolveInitialLanguage('fr', ['ja'])).toBe('en');
  });
});
