import { describe, it, expect } from 'vitest';
import { pickTranslatePopoverSide } from '../../src/utils/bookTranslatePopover';

const VIEWPORT = 720;
const PANEL = 190;
const base = {
  popoverHeight: PANEL,
  viewportHeight: VIEWPORT,
  margin: 12,
  gap: 10,
};

describe('pickTranslatePopoverSide', () => {
  it('hangs below the selection when there is room', () => {
    expect(
      pickTranslatePopoverSide({ ...base, selectionTop: 330, selectionBottom: 350 }),
    ).toBe('below');
  });

  it('flips above when the panel would be cut off by the bottom edge', () => {
    // 选区贴着窗口下沿：挂在下方，底边会超出视口。
    expect(
      pickTranslatePopoverSide({ ...base, selectionTop: 570, selectionBottom: 600 }),
    ).toBe('above');
  });

  it('keeps it below near the top, where there is no room above', () => {
    expect(
      pickTranslatePopoverSide({ ...base, selectionTop: 60, selectionBottom: 90 }),
    ).toBe('below');
  });

  it('falls back to below only when neither side can hold the panel', () => {
    // 选区几乎占满整屏：两边都塞不下，至少下方还有个确定的落点。
    expect(
      pickTranslatePopoverSide({
        ...base,
        selectionTop: 20,
        selectionBottom: VIEWPORT - 20,
        popoverHeight: 300,
      }),
    ).toBe('below');
  });

  it('respects the margin on the bottom edge', () => {
    // 底边正好压到"视口高度 - 边距"上就算放得下，不再翻。
    const bottom = VIEWPORT - 12 - 10 - PANEL;
    expect(
      pickTranslatePopoverSide({
        ...base,
        selectionTop: bottom - 20,
        selectionBottom: bottom,
      }),
    ).toBe('below');
    expect(
      pickTranslatePopoverSide({
        ...base,
        selectionTop: bottom - 20,
        selectionBottom: bottom + 1,
      }),
    ).toBe('above');
  });
});
