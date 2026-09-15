import { describe, it, expect, vi } from 'vitest';
import {
  AiHttpError,
  isAbortLike,
  isTransientAiError,
  withAiTransientRetry,
} from '../../src/utils/aiTransientRetry';

describe('isTransientAiError', () => {
  it('retries Failed to fetch, 429/5xx, and Chinese proxy network errors', () => {
    expect(isTransientAiError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientAiError(new Error('Network error: Load failed'))).toBe(true);
    expect(isTransientAiError(new Error('服务器代理网络失败 (Failed to fetch)。'))).toBe(true);
    expect(isTransientAiError(new AiHttpError(429, 'too many'))).toBe(true);
    expect(isTransientAiError(new AiHttpError(502, 'bad gateway'))).toBe(true);
    expect(isTransientAiError(new AiHttpError(503, 'unavailable'))).toBe(true);
  });

  it('does not retry auth, missing keys, or abort', () => {
    expect(isTransientAiError(new AiHttpError(401, 'Unauthorized'))).toBe(false);
    expect(isTransientAiError(new AiHttpError(403, 'Forbidden'))).toBe(false);
    expect(isTransientAiError(new Error('Gemini: API Key missing (set in Settings or GEMINI_API_KEY).'))).toBe(
      false,
    );
    expect(isTransientAiError(new Error('API Key missing for provider "openai".'))).toBe(false);
    expect(isAbortLike(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isTransientAiError(new DOMException('Aborted', 'AbortError'))).toBe(false);
  });
});

describe('withAiTransientRetry', () => {
  it('returns on the first success', async () => {
    const run = vi.fn().mockResolvedValue('ok');
    await expect(withAiTransientRetry(run, { delaysMs: [0, 0] })).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries a network blip then succeeds', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('recovered');
    await expect(withAiTransientRetry(run, { delaysMs: [0] })).resolves.toBe('recovered');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last attempt', async () => {
    const run = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(withAiTransientRetry(run, { delaysMs: [0, 0] })).rejects.toThrow('Failed to fetch');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 401', async () => {
    const run = vi.fn().mockRejectedValue(new AiHttpError(401, 'Unauthorized'));
    await expect(withAiTransientRetry(run, { delaysMs: [0, 0] })).rejects.toThrow('Unauthorized');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
