import { describe, it, expect, afterEach } from 'vitest';
import {
  findPassageRange,
  isPointInRange,
  isRangeVisibleIn,
  scrollPassageIntoView,
} from '../../src/utils/bookPassage';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findPassageRange', () => {
  it('locates a passage inside one block', () => {
    const root = mount('<div>他带的研究生的科研技能，大部分并不是由他亲自传授的。</div>');
    const range = findPassageRange(root, '大部分并不是由他亲自传授的');
    expect(range?.toString()).toBe('大部分并不是由他亲自传授的');
  });

  it('matches across the whitespace the excerpt collapsed away', () => {
    // 摘抄存的是把换行折成空格的形式，DOM 里还留着原始换行——直接 indexOf 是对不上的。
    const root = mount('<div>第一段的话。\n\n第二段的话。</div>');
    const range = findPassageRange(root, '第一段的话。 第二段的话。');
    expect(range).not.toBeNull();
    expect(range?.toString()).toContain('第二段的话');
  });

  it('covers a passage spanning several blocks with one range', () => {
    const root = mount('<div>前面那一句。</div><div>后面那一句。</div>');
    const range = findPassageRange(root, '前面那一句。 后面那一句。');
    expect(range).not.toBeNull();
    expect(range?.toString()).toContain('前面那一句');
    expect(range?.toString()).toContain('后面那一句');
  });

  it('returns null when the passage is not in this chapter', () => {
    const root = mount('<div>这一章讲的是古着。</div>');
    expect(findPassageRange(root, '这段文字根本不在这一章里')).toBeNull();
  });

  it('refuses a passage too short to place safely', () => {
    const root = mount('<div>短。</div>');
    expect(findPassageRange(root, '短')).toBeNull();
    expect(findPassageRange(root, '   ')).toBeNull();
  });

  it('ignores text inside script and style', () => {
    const root = mount('<style>.a{color:red}</style><div>正文里的一句话。</div>');
    // 样式表里的字符不该被当成正文命中。
    expect(findPassageRange(root, 'color:red')).toBeNull();
  });
});

describe('scrollPassageIntoView', () => {
  it('reports false when the passage is absent, without throwing', () => {
    const root = mount('<div>这一章讲的是古着。</div>');
    expect(scrollPassageIntoView(root, '不在这一章的文字')).toBe(false);
  });
});

/** jsdom 量不出矩形，命中判断都得先把矩形塞给这段 Range。 */
function withRects(
  range: Range,
  rects: Array<{ left: number; right: number; top: number; bottom: number }>,
) {
  // width/height 得一并给全：量不出大小的矩形会被当成"还没布局"而被跳过。
  const full = rects.map((rect) => ({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  }));
  range.getClientRects = () => full as unknown as DOMRectList;
  return range;
}

function rangeOf(text: string): Range {
  const node = document.createTextNode(text);
  document.body.appendChild(node);
  const range = document.createRange();
  range.selectNodeContents(node);
  return range;
}

/** 可视区判断要的是一个元素；给它一个说得清高度的假盒子。 */
function containerOf(height = 800): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.getBoundingClientRect = () => ({ top: 0, bottom: height }) as DOMRect;
  return el;
}

describe('isPointInRange', () => {
  it('counts a point inside one of the passage lines', () => {
    const range = withRects(rangeOf('一段话'), [
      { left: 100, right: 400, top: 200, bottom: 240 },
    ]);
    expect(isPointInRange(range, 200, 220)).toBe(true);
  });

  it('keeps the gap between two lines inside the passage', () => {
    // 鼠标停在行间空当里也是在读这段，撤高亮不该在这种缝里触发。
    const range = withRects(rangeOf('一段话'), [
      { left: 100, right: 400, top: 200, bottom: 240 },
      { left: 100, right: 400, top: 250, bottom: 290 },
    ]);
    expect(isPointInRange(range, 200, 245)).toBe(true);
  });

  it('says no for a point well outside the passage', () => {
    const range = withRects(rangeOf('一段话'), [
      { left: 100, right: 400, top: 200, bottom: 240 },
    ]);
    expect(isPointInRange(range, 40, 220)).toBe(false);
  });

  it('says no when the range has no measurable rects at all', () => {
    // 量不到就是「不能认定鼠标在这段上」；反过来会把刚跳回来的落点提前撤掉。
    expect(isPointInRange(rangeOf('一段话'), 200, 220)).toBe(false);
  });
});

describe('isRangeVisibleIn', () => {
  it('says yes while a line of the passage is still in view', () => {
    const range = withRects(rangeOf('一段话'), [
      { left: 100, right: 400, top: 200, bottom: 240 },
    ]);
    expect(isRangeVisibleIn(range, containerOf())).toBe(true);
  });

  it('says no once the passage has scrolled out of view', () => {
    const range = withRects(rangeOf('一段话'), [
      { left: 100, right: 400, top: 1200, bottom: 1240 },
    ]);
    expect(isRangeVisibleIn(range, containerOf())).toBe(false);
  });

  it('assumes visible when there is nothing to measure', () => {
    expect(isRangeVisibleIn(rangeOf('一段话'), containerOf())).toBe(true);
  });
});
