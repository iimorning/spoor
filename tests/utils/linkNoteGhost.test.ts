import { describe, it, expect } from 'vitest';
import { placeLinkNoteGhost } from '../../src/utils/linkNoteGhost';

describe('placeLinkNoteGhost', () => {
  it('positions via translate3d, not left/top', () => {
    const el = document.createElement('div');
    el.style.left = '40px';
    el.style.top = '80px';
    placeLinkNoteGhost(el, 120, 60);
    expect(el.style.transform).toBe('translate3d(120px, 60px, 0px) translate(-50%, -50%)');
    expect(el.style.left).toBe('40px');
    expect(el.style.top).toBe('80px');
  });
});
