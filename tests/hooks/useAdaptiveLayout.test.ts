import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  COMPACT_MQ,
  TOUCH_CHROME_MQ,
  PHONE_MQ,
  detectAdaptiveLayout,
  useAdaptiveLayout,
} from '../../src/hooks/useAdaptiveLayout';

type MediaListener = () => void;

function installMatchMedia(matchesFor: (query: string) => boolean) {
  const listeners = new Map<string, Set<MediaListener>>();
  const lists = new Map<string, MediaQueryList>();

  const matchMedia = (query: string): MediaQueryList => {
    const existing = lists.get(query);
    if (existing) return existing;
    const list = {
      media: query,
      get matches() {
        return matchesFor(query);
      },
      onchange: null,
      addEventListener: (_type: string, cb: EventListener) => {
        let set = listeners.get(query);
        if (!set) {
          set = new Set();
          listeners.set(query, set);
        }
        set.add(cb as MediaListener);
      },
      removeEventListener: (_type: string, cb: EventListener) => {
        listeners.get(query)?.delete(cb as MediaListener);
      },
      addListener: (cb: MediaListener) => {
        let set = listeners.get(query);
        if (!set) {
          set = new Set();
          listeners.set(query, set);
        }
        set.add(cb);
      },
      removeListener: (cb: MediaListener) => {
        listeners.get(query)?.delete(cb);
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    lists.set(query, list);
    return list;
  };

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: matchMedia,
  });

  return {
    fire(query: string) {
      for (const cb of listeners.get(query) ?? []) cb();
    },
  };
}

describe('detectAdaptiveLayout', () => {
  const original = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: original,
    });
  });

  it('1366px 精细指针笔记本不是 compact，也不是 touchChrome', () => {
    installMatchMedia(() => false);
    expect(detectAdaptiveLayout()).toEqual({ compact: false, touchChrome: false, phone: false });
  });

  it('窄视口单独打开 compact', () => {
    installMatchMedia((q) => q === COMPACT_MQ);
    expect(detectAdaptiveLayout()).toEqual({ compact: true, touchChrome: false, phone: false });
  });

  it('二合一触屏（any-pointer: coarse）单独打开 touchChrome', () => {
    installMatchMedia((q) => q === TOUCH_CHROME_MQ);
    expect(detectAdaptiveLayout()).toEqual({ compact: false, touchChrome: true, phone: false });
  });

  it('窄屏触控两路同时为 true，互不合并成单一开关', () => {
    installMatchMedia((q) => q === COMPACT_MQ || q === TOUCH_CHROME_MQ);
    expect(detectAdaptiveLayout()).toEqual({ compact: true, touchChrome: true, phone: false });
  });

  it('手机视口（窄且 coarse）才打开 phone，不把平板当成口袋主页', () => {
    installMatchMedia((q) => q === PHONE_MQ || q === COMPACT_MQ || q === TOUCH_CHROME_MQ);
    expect(detectAdaptiveLayout()).toEqual({ compact: true, touchChrome: true, phone: true });
  });
});

describe('useAdaptiveLayout', () => {
  const original = window.matchMedia;
  let compactOn = false;
  let touchOn = false;
  let phoneOn = false;
  let media: { fire: (query: string) => void };

  beforeEach(() => {
    compactOn = false;
    touchOn = false;
    phoneOn = false;
    media = installMatchMedia((q) => {
      if (q === COMPACT_MQ) return compactOn;
      if (q === TOUCH_CHROME_MQ) return touchOn;
      if (q === PHONE_MQ) return phoneOn;
      return false;
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: original,
    });
  });

  it('订阅变化后分别更新 compact 与 touchChrome', () => {
    const { result } = renderHook(() => useAdaptiveLayout());
    expect(result.current).toEqual({ compact: false, touchChrome: false, phone: false });

    compactOn = true;
    act(() => media.fire(COMPACT_MQ));
    expect(result.current).toEqual({ compact: true, touchChrome: false, phone: false });

    touchOn = true;
    act(() => media.fire(TOUCH_CHROME_MQ));
    expect(result.current).toEqual({ compact: true, touchChrome: true, phone: false });

    phoneOn = true;
    act(() => media.fire(PHONE_MQ));
    expect(result.current).toEqual({ compact: true, touchChrome: true, phone: true });
  });
});

describe('CSS variants stay aligned with JS queries', () => {
  it('index.css 使用 compact / coarse，且不再用 1366 OR coarse 的旧 tablet 变体', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toContain('@custom-variant compact (@media (max-width: 1279px))');
    expect(css).toContain('@custom-variant coarse (@media (any-pointer: coarse))');
    expect(css).toContain('@custom-variant phone (@media (max-width: 767px) and (any-pointer: coarse))');
    expect(css).not.toMatch(/@custom-variant tablet/);
    expect(css).not.toContain('1366px');
  });
});
