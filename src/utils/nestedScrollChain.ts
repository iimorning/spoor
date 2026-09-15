/** Pause after which a new wheel burst is treated as a separate gesture. */
export const NESTED_SCROLL_CHAIN_IDLE_MS = 320;

export type NestedScrollChainLatch = {
  direction: 1 | -1 | 0;
  phase: 'idle' | 'inner' | 'edge';
  lastTs: number;
  /**
   * True after the first overflow (at the current edge, current direction)
   * has been swallowed. A second overflow in the same burst pans the canvas.
   */
  overflowArmed: boolean;
};

export type NestedScrollChainAction = 'inner' | 'absorb' | 'pan';

export function createNestedScrollChainLatch(): NestedScrollChainLatch {
  return { direction: 0, phase: 'idle', lastTs: 0, overflowArmed: false };
}

/**
 * Nested-scroll latch so reading a note does not immediately pan the canvas.
 *
 * - Content can still move: leave the event to the browser (`inner`).
 * - Same gesture that hits the edge: swallow leftover wheel (`absorb`).
 * - First overflow after sitting at the edge: swallow (`absorb`).
 * - Second overflow in the same burst: allow canvas pan (`pan`).
 * - Idle gap resets the overflow token, so a later single flick is absorbed again.
 */
export function decideNestedScrollChain(
  latch: NestedScrollChainLatch,
  options: {
    now: number;
    direction: 1 | -1;
    canScrollInner: boolean;
  },
): NestedScrollChainAction {
  const { now, direction, canScrollInner } = options;
  const idle = now - latch.lastTs > NESTED_SCROLL_CHAIN_IDLE_MS;
  const sameDir = latch.direction === direction;

  if (canScrollInner) {
    latch.direction = direction;
    latch.phase = 'inner';
    latch.lastTs = now;
    latch.overflowArmed = false;
    return 'inner';
  }

  if (latch.phase === 'inner' && sameDir && !idle) {
    latch.lastTs = now;
    return 'absorb';
  }

  if (!sameDir || idle) {
    latch.overflowArmed = false;
  }

  latch.direction = direction;
  latch.phase = 'edge';
  latch.lastTs = now;

  if (!latch.overflowArmed) {
    latch.overflowArmed = true;
    return 'absorb';
  }

  return 'pan';
}

export function wheelOverflowDirection(deltaY: number): 1 | -1 | 0 {
  if (deltaY > 0) return 1;
  if (deltaY < 0) return -1;
  return 0;
}
