import { describe, it, expect } from 'vitest';
import i18n from '../../src/i18n';
import {
  IMAGE_GEN_ERROR,
  formatImageGenerationError,
  formatImageWaited,
  isImageGenerationTimeoutError,
  isImageSafetyRejection,
} from '../../src/utils/imageGenerationWait';

describe('imageGenerationWait', () => {
  it('maps timeout/stale codes to readable copy and passes other errors through', () => {
    const t = i18n.t.bind(i18n);
    expect(formatImageGenerationError(IMAGE_GEN_ERROR.timeout, t)).not.toBe('timeout');
    expect(formatImageGenerationError(IMAGE_GEN_ERROR.stale, t)).not.toBe('stale');
    expect(formatImageGenerationError(IMAGE_GEN_ERROR.blocked, t)).not.toBe('blocked');
    expect(formatImageGenerationError('402 quota exceeded', t)).toBe('402 quota exceeded');
  });

  it('formats waited seconds', () => {
    const t = i18n.t.bind(i18n);
    expect(formatImageWaited(45_000, t)).toMatch(/45/);
  });

  it('detects Gemini and OpenAI image safety wording', () => {
    expect(
      isImageSafetyRejection('Gemini blocked this request through content filters.'),
    ).toBe(true);
    expect(isImageSafetyRejection('Your request was rejected by the safety system.')).toBe(true);
    expect(isImageSafetyRejection('HTTP 502 gateway')).toBe(false);
  });

  it('detects the timeout Error thrown by generateGptImage2', () => {
    expect(isImageGenerationTimeoutError(new Error(IMAGE_GEN_ERROR.timeout))).toBe(true);
    expect(isImageGenerationTimeoutError(new DOMException('Aborted', 'AbortError'))).toBe(false);
    expect(isImageGenerationTimeoutError(new Error('HTTP 502'))).toBe(false);
  });
});
