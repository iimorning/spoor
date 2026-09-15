import { describe, it, expect } from 'vitest';
import {
  computeEssayEditorToolbarPos,
  computeTextSelectionToolbarPos,
  computeTextSelectionToolbarPosViewport,
} from '../../src/utils/textSelectionToolbarPos';

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    bottom: y + h,
    right: x + w,
    toJSON() {
      return this;
    },
  };
}

describe('computeTextSelectionToolbarPos', () => {
  it('优先放在选区首行上方，并按画布 scale 换算到本地坐标', () => {
    const pos = computeTextSelectionToolbarPos({
      range: {
        getClientRects: () => [rect(120, 80, 40, 16)] as unknown as DOMRectList,
        getBoundingClientRect: () => rect(120, 80, 40, 16),
      },
      positionParent: {
        getBoundingClientRect: () => rect(100, 50, 200, 100),
        offsetHeight: 50,
        clientHeight: 50,
        clientWidth: 100,
      },
      toolbarWidth: 40,
      toolbarHeight: 10,
    });
    // scale = 100/50 = 2; first.top-host.top = 30 → 15 local; 15 - 10 - 8 = -3 → below last line
    expect(pos.top).toBe((80 + 16 - 50) / 2 + 8);
    expect(pos.left).toBe(8);
  });

  it('贴顶时改放到末行下方，并夹在宿主范围内', () => {
    const pos = computeTextSelectionToolbarPos({
      range: {
        getClientRects: () => [rect(10, 2, 20, 8)] as unknown as DOMRectList,
        getBoundingClientRect: () => rect(10, 2, 20, 8),
      },
      positionParent: {
        getBoundingClientRect: () => rect(0, 0, 200, 80),
        offsetHeight: 80,
        clientHeight: 80,
        clientWidth: 200,
      },
      toolbarWidth: 40,
      toolbarHeight: 20,
    });
    expect(pos.top).toBe(2 + 8 + 8);
    expect(pos.left).toBeGreaterThanOrEqual(8);
  });
});

describe('computeEssayEditorToolbarPos', () => {
  it('多行选区按各行并集居中，避免仅用末行右边界导致左偏', () => {
    const rangeProto = Range.prototype as unknown as {
      getClientRects: () => DOMRectList;
    };
    const original = rangeProto.getClientRects;
    rangeProto.getClientRects = function () {
      return [rect(100, 80, 400, 18), rect(100, 110, 30, 18)] as unknown as DOMRectList;
    };

    try {
      const pos = computeEssayEditorToolbarPos(
        {
          state: {
            selection: { empty: false, from: 1, to: 40 },
            doc: { textBetween: () => '以手机应用商店上APP，所以' },
          },
          view: {
            dom: document.createElement('div'),
            domAtPos: (pos: number) => {
              const node = document.createTextNode('line');
              return { node, offset: pos > 20 ? 2 : 0 };
            },
            coordsAtPos: (pos: number) => {
              if (pos <= 1) return rect(100, 80, 0, 18);
              if (pos >= 40) return rect(130, 110, 0, 18);
              return rect(100, 80, 0, 18);
            },
          },
        },
        120,
        36,
      );
      expect(pos).toEqual({ top: 80 - 36 - 8, left: 100 + 400 / 2 });
    } finally {
      rangeProto.getClientRects = original;
    }
  });
});

describe('computeTextSelectionToolbarPosViewport', () => {
  it('把工具条放在选区首行上方，使用视口坐标', () => {
    const pos = computeTextSelectionToolbarPosViewport({
      range: {
        getClientRects: () => [rect(400, 300, 80, 18)] as unknown as DOMRectList,
        getBoundingClientRect: () => rect(400, 300, 80, 18),
      },
      toolbarWidth: 120,
      toolbarHeight: 36,
      clamp: { top: 80, left: 200, right: 800, bottom: 700 },
    });
    expect(pos.top).toBe(300 - 36 - 8);
    expect(pos.left).toBe(400 + 40 - 60);
  });
});
