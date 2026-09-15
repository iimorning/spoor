import { describe, it, expect } from 'vitest';
import {
  NESTED_SCROLL_CHAIN_IDLE_MS,
  createNestedScrollChainLatch,
  decideNestedScrollChain,
  wheelOverflowDirection,
} from '../../src/utils/nestedScrollChain';

describe('wheelOverflowDirection', () => {
  it('maps deltaY to 1 / -1 / 0', () => {
    expect(wheelOverflowDirection(40)).toBe(1);
    expect(wheelOverflowDirection(-12)).toBe(-1);
    expect(wheelOverflowDirection(0)).toBe(0);
  });
});

describe('decideNestedScrollChain', () => {
  it('内容还能滚动时交给内部，并清掉 overflow 标记', () => {
    const latch = createNestedScrollChainLatch();
    latch.overflowArmed = true;
    expect(
      decideNestedScrollChain(latch, { now: 100, direction: 1, canScrollInner: true }),
    ).toBe('inner');
    expect(latch.phase).toBe('inner');
    expect(latch.overflowArmed).toBe(false);
  });

  it('同一轮内部滚动触边后，剩余滚轮被吞掉', () => {
    const latch = createNestedScrollChainLatch();
    decideNestedScrollChain(latch, { now: 100, direction: 1, canScrollInner: true });
    expect(
      decideNestedScrollChain(latch, { now: 120, direction: 1, canScrollInner: false }),
    ).toBe('absorb');
    expect(
      decideNestedScrollChain(latch, { now: 140, direction: 1, canScrollInner: false }),
    ).toBe('absorb');
  });

  it('已在边界时：第一次溢出吞掉，第二次才允许交给画布', () => {
    const latch = createNestedScrollChainLatch();
    expect(
      decideNestedScrollChain(latch, { now: 50, direction: 1, canScrollInner: false }),
    ).toBe('absorb');
    expect(
      decideNestedScrollChain(latch, { now: 80, direction: 1, canScrollInner: false }),
    ).toBe('pan');
    expect(
      decideNestedScrollChain(latch, { now: 100, direction: 1, canScrollInner: false }),
    ).toBe('pan');
  });

  it('停顿超过 idle 后重新武装：下一次单次溢出再次吞掉', () => {
    const latch = createNestedScrollChainLatch();
    decideNestedScrollChain(latch, { now: 0, direction: 1, canScrollInner: false });
    decideNestedScrollChain(latch, { now: 20, direction: 1, canScrollInner: false });
    expect(
      decideNestedScrollChain(latch, {
        now: 20 + NESTED_SCROLL_CHAIN_IDLE_MS + 1,
        direction: 1,
        canScrollInner: false,
      }),
    ).toBe('absorb');
  });

  it('换方向会重置 overflow 标记', () => {
    const latch = createNestedScrollChainLatch();
    decideNestedScrollChain(latch, { now: 0, direction: 1, canScrollInner: false });
    expect(
      decideNestedScrollChain(latch, { now: 30, direction: -1, canScrollInner: false }),
    ).toBe('absorb');
    expect(
      decideNestedScrollChain(latch, { now: 50, direction: -1, canScrollInner: false }),
    ).toBe('pan');
  });
});
