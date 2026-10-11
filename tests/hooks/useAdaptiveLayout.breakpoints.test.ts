import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAdaptiveLayout, COMPACT_MQ, TOUCH_CHROME_MQ, PHONE_MQ } from '../../src/hooks/useAdaptiveLayout';
import { setMatchMediaQueries } from '../setup';

/**
 * 这组用例存在的理由：`tests/setup.ts` 以前把 `matchMedia` 桩成恒 false，
 * 于是 compact / touch / phone 三个信号在**所有**测试里都取不到真值——窄屏分支
 * 一次都没被跑过。现在 matchMedia 可按用例覆写，这里把三条断点本身钉住，
 * 顺带让后面要测窄屏界面的用例有个可信的开关。
 */
afterEach(() => {
  setMatchMediaQueries([]);
});

describe('useAdaptiveLayout', () => {
  it('默认（jsdom 无媒体特性）三条信号都不成立', () => {
    setMatchMediaQueries([]);
    const { result } = renderHook(() => useAdaptiveLayout());
    expect(result.current).toEqual({ compact: false, touchChrome: false, phone: false });
  });

  it('窄屏：compact 单独成立，不牵动另外两条', () => {
    setMatchMediaQueries([COMPACT_MQ]);
    const { result } = renderHook(() => useAdaptiveLayout());
    expect(result.current.compact).toBe(true);
    // 触屏和手机各有自己的条件，不能被 compact 顺带捎上——
    // 一个窄的桌面窗口不该被当成手机。
    expect(result.current.touchChrome).toBe(false);
    expect(result.current.phone).toBe(false);
  });

  it('触屏但够宽：touchChrome 成立而 compact 不成立', () => {
    setMatchMediaQueries([TOUCH_CHROME_MQ]);
    const { result } = renderHook(() => useAdaptiveLayout());
    expect(result.current.touchChrome).toBe(true);
    expect(result.current.compact).toBe(false);
  });

  it('窄屏 + 触屏才是手机', () => {
    setMatchMediaQueries([COMPACT_MQ, TOUCH_CHROME_MQ]);
    const { result } = renderHook(() => useAdaptiveLayout());
    // phone 的查询同时含窄屏和粗指针两个条件，所以两条都开才命中。
    expect(result.current.phone).toBe(result.current.compact && result.current.touchChrome);
  });

  it('PHONE_MQ 确实同时要求窄屏和粗指针', () => {
    // 这条是"手机"不是"窄屏"的契约本身：少一个条件都不该命中。
    expect(PHONE_MQ).toContain('max-width');
    expect(PHONE_MQ).toContain('coarse');
    setMatchMediaQueries([PHONE_MQ]);
    const { result } = renderHook(() => useAdaptiveLayout());
    expect(result.current.phone).toBe(true);
  });
});
