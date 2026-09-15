import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openExternalUrl } from '../../src/utils/openExternal';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('openExternalUrl', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    mockInvoke.mockClear().mockResolvedValue(undefined);
    Reflect.deleteProperty(window as Window & { __TAURI_INTERNALS__?: unknown }, '__TAURI_INTERNALS__');
  });

  afterEach(() => {
    warnSpy.mockRestore();
    openSpy.mockRestore();
    Reflect.deleteProperty(window as Window & { __TAURI_INTERNALS__?: unknown }, '__TAURI_INTERNALS__');
  });

  it('opens https URL in a new browser tab when not Tauri', async () => {
    await openExternalUrl('https://example.com/path?q=1');
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/path?q=1',
      '_blank',
      'noopener,noreferrer',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('accepts http and trims whitespace before opening', async () => {
    await openExternalUrl('  http://a.com/x  ');
    expect(openSpy).toHaveBeenCalledWith('http://a.com/x', '_blank', 'noopener,noreferrer');
  });

  it('skips non-http(s) schemes and warns without opening', async () => {
    await openExternalUrl('ftp://x');
    await openExternalUrl('javascript:alert(1)');
    expect(openSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('openExternalUrl skipped');
  });

  it('invokes Tauri open_external_url when running inside Tauri', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    await openExternalUrl('https://x.com/page');
    expect(mockInvoke).toHaveBeenCalledWith('open_external_url', { url: 'https://x.com/page' });
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('openCheckoutUrl', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    mockInvoke.mockClear().mockResolvedValue(undefined);
    Reflect.deleteProperty(window as Window & { __TAURI_INTERNALS__?: unknown }, '__TAURI_INTERNALS__');
  });

  afterEach(() => {
    openSpy.mockRestore();
    Reflect.deleteProperty(window as Window & { __TAURI_INTERNALS__?: unknown }, '__TAURI_INTERNALS__');
  });

  it('navigates the current tab on the web so checkout is not popup-blocked', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, href: 'https://spoor.ink/pricing' });
    const { openCheckoutUrl } = await import('../../src/utils/openExternal');
    await openCheckoutUrl('https://waffo.test/pay/wx');
    expect(assign).toHaveBeenCalledWith('https://waffo.test/pay/wx');
    expect(openSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('opens the system browser in Tauri instead of assigning location', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, href: 'https://spoor.ink/pricing' });
    const { openCheckoutUrl } = await import('../../src/utils/openExternal');
    await openCheckoutUrl('https://waffo.test/pay/wx');
    expect(mockInvoke).toHaveBeenCalledWith('open_external_url', { url: 'https://waffo.test/pay/wx' });
    expect(assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
