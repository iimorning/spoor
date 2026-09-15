import { describe, it, expect } from 'vitest';
import { positionTooltip } from '../../src/onboarding/positionTooltip';

const viewport = { width: 1024, height: 768 };

describe('positionTooltip', () => {
  it('uses the preferred placement when it fits', () => {
    const target = new DOMRect(400, 300, 120, 60);
    const tooltip = { width: 280, height: 120 };

    const result = positionTooltip(target, tooltip, viewport, 'right');

    // right: top should be vertically centered on target, left = target.right + gap
    expect(result.placement).toBe('right');
    expect(result.left).toBe(target.right + 12);
    expect(result.top).toBe(
      target.top + target.height / 2 - tooltip.height / 2,
    );
  });

  it('places tooltip above the target when preferred = top', () => {
    const target = new DOMRect(400, 400, 120, 60);
    const tooltip = { width: 280, height: 120 };

    const result = positionTooltip(target, tooltip, viewport, 'top');

    expect(result.placement).toBe('top');
    expect(result.top).toBe(target.top - tooltip.height - 12);
    expect(result.left).toBe(target.left + target.width / 2 - tooltip.width / 2);
  });

  it('falls back to bottom when preferred = top would overflow the top', () => {
    const target = new DOMRect(400, 10, 120, 60);
    const tooltip = { width: 280, height: 120 };

    const result = positionTooltip(target, tooltip, viewport, 'top');

    expect(result.placement).toBe('bottom');
    expect(result.top).toBe(target.bottom + 12);
  });

  it('prefers another placement over clamping when preferred overflows', () => {
    const target = new DOMRect(900, 300, 120, 60);
    const tooltip = { width: 280, height: 120 };

    // Right would overflow; left still fits, so we use that.
    const result = positionTooltip(target, tooltip, viewport, 'right');

    expect(result.placement).toBe('left');
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left + tooltip.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it('aligns left placement to the target bottom when align = end', () => {
    const target = new DOMRect(820, 180, 280, 420);
    const tooltip = { width: 380, height: 200 };

    const result = positionTooltip(target, tooltip, viewport, 'left', 'end');

    expect(result.placement).toBe('left');
    expect(result.top).toBe(target.bottom - tooltip.height);
    expect(result.left).toBe(target.left - tooltip.width - 12);
  });

  it('clamps to viewport when no placement fits at all', () => {
    // tiny viewport where no anchor around a large target can hold the tooltip.
    const tiny = { width: 240, height: 200 };
    const target = new DOMRect(20, 20, 80, 40);
    const tooltip = { width: 280, height: 180 };

    const result = positionTooltip(target, tooltip, tiny, 'top');

    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.left).toBeLessThanOrEqual(tiny.width - 8);
    expect(result.top).toBeLessThanOrEqual(tiny.height - 8);
  });

  it('keeps the tooltip inside the viewport when target is at the top-left', () => {
    const target = new DOMRect(0, 0, 80, 40);
    const tooltip = { width: 280, height: 120 };

    const result = positionTooltip(target, tooltip, viewport, 'top');

    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.left + tooltip.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(result.top + tooltip.height).toBeLessThanOrEqual(viewport.height - 8);
  });

  it('shrinks a tooltip that is wider than the viewport', () => {
    const target = new DOMRect(400, 300, 120, 60);
    const tooltip = { width: 2000, height: 120 };
    const smallViewport = { width: 600, height: 400 };

    const result = positionTooltip(target, tooltip, smallViewport, 'right');

    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left).toBeLessThanOrEqual(smallViewport.width - 8);
  });
});