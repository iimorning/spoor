import { describe, expect, it } from 'vitest';
import {
  appendPublishOrderId,
  finalizePublishOrder,
  hitTestPublishCandidate,
} from '../../src/utils/publishStrokeSequence';

describe('publishStrokeSequence', () => {
  it('appendPublishOrderId skips duplicates', () => {
    expect(appendPublishOrderId(['a'], 'b')).toEqual(['a', 'b']);
    expect(appendPublishOrderId(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });

  it('finalizePublishOrder keeps stroke order then appends remainder', () => {
    expect(finalizePublishOrder(['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    expect(finalizePublishOrder([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(finalizePublishOrder(['x'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('hitTestPublishCandidate prefers first matching candidate not yet ordered', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    Object.defineProperty(a, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    });
    Object.defineProperty(b, 'getBoundingClientRect', {
      value: () => ({ left: 50, top: 50, right: 150, bottom: 150 }),
    });
    const nodes = { a, b };
    expect(hitTestPublishCandidate(60, 60, ['a', 'b'], nodes, new Set())).toBe('a');
    expect(hitTestPublishCandidate(60, 60, ['a', 'b'], nodes, new Set(['a']))).toBe('b');
    expect(hitTestPublishCandidate(200, 200, ['a', 'b'], nodes, new Set())).toBeNull();
  });
});
