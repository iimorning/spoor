import { describe, expect, it } from 'vitest';
import { transformToFitNodes } from '../../src/utils/canvasViewport';

describe('transformToFitNodes', () => {
  it('returns default transform for empty nodes', () => {
    expect(transformToFitNodes([], { width: 1000, height: 800 })).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    });
  });

  it('centers a single card and keeps a usable scale', () => {
    const t = transformToFitNodes([{ x: 0, y: 0, width: 320, height: 200 }], {
      width: 1000,
      height: 800,
    });
    expect(t.scale).toBeGreaterThan(0.5);
    expect(t.x).toBeCloseTo(1000 / 2 - 160 * t.scale, 5);
    expect(t.y).toBeCloseTo(800 / 2 - 100 * t.scale, 5);
  });

  it('shrinks scale when the bbox is larger than the viewport', () => {
    const t = transformToFitNodes(
      [
        { x: 0, y: 0, width: 200, height: 200 },
        { x: 4000, y: 3000, width: 200, height: 200 },
      ],
      { width: 800, height: 600 },
    );
    expect(t.scale).toBeLessThan(0.3);
    expect(t.scale).toBeGreaterThanOrEqual(0.1);
  });
});
