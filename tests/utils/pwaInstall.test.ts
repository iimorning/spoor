import { describe, it, expect, vi, afterEach } from 'vitest';
import { isIosWeb, isStandaloneDisplay } from '../../src/utils/pwaInstall';

describe('pwaInstall utils', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('detects iOS user agents', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    );
    expect(isIosWeb()).toBe(true);
  });

  it('detects standalone display mode', () => {
    window.matchMedia = (query: string) =>
      ({
        matches: query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
    expect(isStandaloneDisplay()).toBe(true);
  });
});
