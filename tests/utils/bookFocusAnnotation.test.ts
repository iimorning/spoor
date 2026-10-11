import { describe, it, expect, afterEach } from 'vitest';
import {
  applyBookFocusAnnotations,
  clearBookFocusAnnotations,
  BOOK_FOCUS_MARK_ATTR,
  BOOK_FOCUS_NOTE_ATTR,
} from '../../src/utils/bookFocusAnnotation';
import { findPassageRange } from '../../src/utils/bookPassage';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('applyBookFocusAnnotations', () => {
  it('wraps the passage and hangs a footnote after it', () => {
    const root = mount('<div>第一段讲的是旧衣服。第二段说，真正穿旧衣服的人不讲究旧。</div>');
    expect(applyBookFocusAnnotations(root, [{ id: 'm1', quote: '真正穿旧衣服的人不讲究旧' }])).toBe(1);

    const mark = root.querySelector(`[${BOOK_FOCUS_MARK_ATTR}]`);
    expect(mark?.tagName).toBe('MARK');
    expect(mark?.textContent).toBe('真正穿旧衣服的人不讲究旧');
    const note = root.querySelector<HTMLElement>(`[${BOOK_FOCUS_NOTE_ATTR}]`);
    // 脚注排在句子后面，不在句子里面——在里面的话这段字会被当成书里的内容。
    expect(note?.previousElementSibling).toBe(mark);
    expect(note?.hidden).toBe(true);
  });

  it('highlights a translated passage without hanging the companion footnote', () => {
    const root = mount('<div>Her enthusiasm for the work was obvious.</div>');
    expect(
      applyBookFocusAnnotations(root, [
        { id: 't1', quote: 'enthusiasm', origin: 'translate' },
      ]),
    ).toBe(1);
    expect(root.querySelector('mark')?.textContent).toBe('enthusiasm');
    expect(root.querySelector(`[${BOOK_FOCUS_NOTE_ATTR}]`)).toBeNull();
  });

  it('marks several passages at once without disturbing the text', () => {
    const root = mount('<div>第一段讲的是旧衣服。第二段说，真正穿旧衣服的人不讲究旧。</div>');
    const applied = applyBookFocusAnnotations(root, [
      { id: 'm1', quote: '第一段讲的是旧衣服' },
      { id: 'm2', quote: '真正穿旧衣服的人不讲究旧' },
    ]);
    expect(applied).toBe(2);
    // 正文一个字没变——划选、复制、查找都还认得它。
    expect(root.textContent).toContain('第一段讲的是旧衣服。第二段说，真正穿旧衣服的人不讲究旧。');
  });

  it('marks across two blocks, one piece each, sharing one footnote', () => {
    // EPUB 的正文按 blocks 渲染，一句话被切在两个块里是常事。
    // `<mark>` 是行内元素、装不下 `<div>`，所以只能一段一个，共用同一个 id。
    const root = mount('<div>前半句在这里</div><div>后半句在那里。</div>');
    expect(applyBookFocusAnnotations(root, [{ id: 'm1', quote: '这里后半句在那里' }])).toBe(1);

    const pieces = [...root.querySelectorAll(`[${BOOK_FOCUS_MARK_ATTR}]`)];
    expect(pieces.map((el) => el.textContent)).toEqual(['这里', '后半句在那里']);
    expect(new Set(pieces.map((el) => el.getAttribute(BOOK_FOCUS_MARK_ATTR)))).toEqual(
      new Set(['m1']),
    );
    // 脚注只挂一条，而且挂在最后一段的后面——说明跟着句尾走。
    const notes = [...root.querySelectorAll(`[${BOOK_FOCUS_NOTE_ATTR}]`)];
    expect(notes).toHaveLength(1);
    expect(notes[0].previousElementSibling).toBe(pieces[1]);
  });

  it('skips what no longer fits and keeps the rest', () => {
    // 引文是模型逐字抄回来的，偶尔对不上是常事。让一处失败就把整章丢掉，
    // 用户看到的是"什么都没标"——比少标一处糟得多。
    const root = mount('<div>第一段讲的是旧衣服。</div>');
    const applied = applyBookFocusAnnotations(root, [
      { id: 'm1', quote: '这段根本不在正文里' },
      { id: 'm2', quote: '第一段讲的是旧衣服' },
    ]);
    expect(applied).toBe(1);
    expect(root.querySelector(`[${BOOK_FOCUS_MARK_ATTR}]`)?.getAttribute(BOOK_FOCUS_MARK_ATTR)).toBe('m2');
  });

  it('does not mark a passage that appears twice', () => {
    // 存的时候已经拒过一次，这里再挡一道：数据可能是别处写进来的。
    const root = mount('<div>他说了一句话。他说了一句话。他又说了一句话。</div>');
    expect(applyBookFocusAnnotations(root, [{ id: 'm1', quote: '他说了一句话' }])).toBe(0);
  });

  it('replaces the previous round instead of stacking on it', () => {
    const root = mount('<div>第一段讲的是旧衣服。第二段说，真正穿旧衣服的人不讲究旧。</div>');
    applyBookFocusAnnotations(root, [{ id: 'm1', quote: '第一段讲的是旧衣服' }]);
    applyBookFocusAnnotations(root, [{ id: 'm2', quote: '真正穿旧衣服的人不讲究旧' }]);
    expect(root.querySelectorAll(`[${BOOK_FOCUS_MARK_ATTR}]`)).toHaveLength(1);
    expect(root.querySelectorAll(`[${BOOK_FOCUS_NOTE_ATTR}]`)).toHaveLength(1);
  });
});

describe('clearBookFocusAnnotations', () => {
  it('gives back exactly the text it was given', () => {
    const before = '第一段讲的是旧衣服。\n\n第二段说，真正穿旧衣服的人不讲究旧。';
    const root = mount(`<div>${before.replace(/\n/g, '<br>')}</div>`);
    const textBefore = root.textContent;
    applyBookFocusAnnotations(root, [{ id: 'm1', quote: '真正穿旧衣服的人不讲究旧' }]);
    clearBookFocusAnnotations(root);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
    expect(root.querySelectorAll(`[${BOOK_FOCUS_NOTE_ATTR}]`)).toHaveLength(0);
    expect(root.textContent).toBe(textBefore);
  });

  it('leaves nothing behind when called twice', () => {
    const root = mount('<div>第一段讲的是旧衣服。</div>');
    applyBookFocusAnnotations(root, [{ id: 'm1', quote: '第一段讲的是旧衣服' }]);
    clearBookFocusAnnotations(root);
    clearBookFocusAnnotations(root);
    expect(root.textContent).toBe('第一段讲的是旧衣服。');
  });
});

describe('the footnote does not count as book text', () => {
  it('leaves the jump-back lookup alone', () => {
    // 「跳回原文」靠把引文映射回 DOM 来定位。脚注是界面上的字，不是书里的字；
    // 混进映射里会把落点顶偏，所以映射要绕开它（ttsFollowAlongDom 里加了这条排除）。
    const root = mount('<div>第一段讲的是旧衣服。</div>');
    applyBookFocusAnnotations(root, [{ id: 'm1', quote: '第一段讲的是旧衣服' }]);
    const note = root.querySelector<HTMLElement>(`[${BOOK_FOCUS_NOTE_ATTR}]`)!;
    note.hidden = false;
    note.textContent = '这一段其实在讲别的事情，和你以为的不一样，值得多看一眼。';

    expect(findPassageRange(root, '第一段讲的是旧衣服')).not.toBeNull();
  });
});
