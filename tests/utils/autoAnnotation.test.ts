import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AUTO_ANNOTATION_EVENT,
  isAutoAnnotationEnabled,
  setAutoAnnotationEnabled,
  type AutoAnnotationFamily,
} from '../../src/utils/autoAnnotation';

const FAMILIES: AutoAnnotationFamily[] = ['essay', 'book', 'room'];

describe('autoAnnotation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // 升级之后不该突然发现 AI 不读了——写进去之前，开关一直是自动的。
  it('没写过的都算开着', () => {
    for (const family of FAMILIES) {
      expect(isAutoAnnotationEnabled(family)).toBe(true);
    }
  });

  // 用户说的就是这个：「关闭长文的自动标注按钮，其他的长文都会默认关闭」。
  // 三族各管各的，但同一族里没有"这一篇/那一篇"之分。
  it('关掉一族只影响那一族，另外两族照旧', () => {
    setAutoAnnotationEnabled('essay', false);
    expect(isAutoAnnotationEnabled('essay')).toBe(false);
    expect(isAutoAnnotationEnabled('book')).toBe(true);
    expect(isAutoAnnotationEnabled('room')).toBe(true);
  });

  it('三族各写各的键，互不串', () => {
    for (const family of FAMILIES) setAutoAnnotationEnabled(family, false);
    for (const family of FAMILIES) expect(isAutoAnnotationEnabled(family)).toBe(false);

    setAutoAnnotationEnabled('book', true);
    expect(isAutoAnnotationEnabled('book')).toBe(true);
    expect(isAutoAnnotationEnabled('essay')).toBe(false);
    expect(isAutoAnnotationEnabled('room')).toBe(false);
  });

  // 长文页、读书页、画布房间可能都开着；在一处改了，别处要立刻知道，
  // 不然用户看到的是"我明明关了，它还在标"。
  it('改一处会广播出去，已经挂载的面板听得到', () => {
    const onChange = vi.fn();
    window.addEventListener(AUTO_ANNOTATION_EVENT, onChange);
    setAutoAnnotationEnabled('room', false);
    expect(onChange).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTO_ANNOTATION_EVENT, onChange);
  });

  it('localStorage 整个不可用时不抛，缺省仍是开着', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(isAutoAnnotationEnabled('essay')).toBe(true);
    expect(() => setAutoAnnotationEnabled('essay', false)).not.toThrow();
    getItem.mockRestore();
  });
});