import { describe, it, expect } from 'vitest';
import {
  applyLiveNodeRotate,
  beginNodeRotate,
  cardGestureTransform,
  clearNodeDragOffset,
  endNodeRotate,
  readNodeDragOffset,
  setNodeDragOffset,
  setNodeRotateDeg,
} from '../../src/utils/nodeDragVisual';

/** Drag must keep reading CSS vars after rotate; a baked `translate(12px, …)` breaks follow. */
function expectDragOwnedTransform(el: HTMLElement) {
  expect(el.style.transform).toContain('var(--drag-x');
  expect(el.style.transform).toContain('var(--drag-y');
  expect(el.style.transform).toContain('var(--node-rotate');
  expect(el.style.transform).not.toMatch(/translate\(\s*-?\d/);
}

describe('nodeDragVisual', () => {
  it('sets CSS vars and dataset for compositor drag', () => {
    const el = document.createElement('div');
    setNodeDragOffset(el, 12.5, -4);
    expect(el.style.getPropertyValue('--drag-x')).toBe('12.5px');
    expect(el.style.getPropertyValue('--drag-y')).toBe('-4px');
    expect(readNodeDragOffset(el)).toEqual({ x: 12.5, y: -4 });
    expect(el.dataset.dragging).toBe('');
  });

  it('cardGestureTransform is the idle contract both drag and rotate share', () => {
    expect(cardGestureTransform('12deg')).toBe(
      'translate(var(--drag-x, 0px), var(--drag-y, 0px)) rotate(var(--node-rotate, 12deg))',
    );
  });

  it('idle setNodeRotateDeg does not bake transform (drag vars must keep working)', () => {
    const el = document.createElement('div');
    el.style.transform = cardGestureTransform();
    setNodeRotateDeg(el, -12.5);
    expect(el.style.getPropertyValue('--node-rotate')).toBe('-12.5deg');
    expectDragOwnedTransform(el);
  });

  it('live rotate uses a concrete transform, then restores drag-owned vars', () => {
    const el = document.createElement('div');
    el.style.transform = cardGestureTransform();
    beginNodeRotate(el);
    applyLiveNodeRotate(el, 15);
    expect(el.style.transform).toBe('translate(0px, 0px) rotate(15deg)');
    expect(el.style.transform).not.toContain('var(--drag-x');
    endNodeRotate(el);
    expect(el.dataset.rotating).toBeUndefined();
    expectDragOwnedTransform(el);
    setNodeDragOffset(el, 10, 20);
    expect(el.style.getPropertyValue('--drag-x')).toBe('10px');
    expect(el.style.getPropertyValue('--drag-y')).toBe('20px');
    expectDragOwnedTransform(el);
  });

  it('commits left/top and clears drag offset', () => {
    const el = document.createElement('div');
    setNodeDragOffset(el, 10, 20);
    clearNodeDragOffset(el, { x: 110, y: 220 });
    expect(el.style.left).toBe('110px');
    expect(el.style.top).toBe('220px');
    expect(el.style.getPropertyValue('--drag-x')).toBe('0px');
    expect(readNodeDragOffset(el)).toEqual({ x: 0, y: 0 });
    expect(el.dataset.dragging).toBeUndefined();
  });
});
