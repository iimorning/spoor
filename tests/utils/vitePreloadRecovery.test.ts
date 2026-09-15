import { describe, expect, it, vi } from 'vitest';
import { recoverFromVitePreloadError } from '../../src/utils/vitePreloadRecovery';

describe('recoverFromVitePreloadError', () => {
  it('reloads once when a deployed dynamic chunk is no longer available', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const reload = vi.fn();
    const first = new Event('vite:preloadError', { cancelable: true }) as Event & {
      payload?: unknown;
    };
    first.payload = new Error('Failed to fetch dynamically imported module: old-chunk.js');

    expect(recoverFromVitePreloadError(first, storage, reload)).toBe(true);
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();

    const repeated = new Event('vite:preloadError', { cancelable: true }) as Event & {
      payload?: unknown;
    };
    repeated.payload = first.payload;
    expect(recoverFromVitePreloadError(repeated, storage, reload)).toBe(false);
    expect(repeated.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not risk a reload loop when session storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: vi.fn(),
    };
    const reload = vi.fn();
    const event = new Event('vite:preloadError', { cancelable: true });

    expect(recoverFromVitePreloadError(event, storage, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
