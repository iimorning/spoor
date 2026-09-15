import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { essayEditorActionLabels } from '../../src/utils/essayEditorActionLabels';

describe('essayEditorActionLabels', () => {
  beforeEach(() => {
    localStorage.removeItem('app_language');
  });

  afterEach(() => {
    localStorage.removeItem('app_language');
  });

  it('uses 应用 / 拒绝 when the saved UI language is zh', () => {
    localStorage.setItem('app_language', 'zh');
    expect(essayEditorActionLabels()).toEqual({
      apply: '应用',
      reject: '拒绝',
      deleteLabel: '（删除）',
    });
  });

  it('uses Apply / Reject when the saved UI language is en', () => {
    localStorage.setItem('app_language', 'en');
    expect(essayEditorActionLabels().apply).toBe('Apply');
    expect(essayEditorActionLabels().reject).toBe('Reject');
  });
});
