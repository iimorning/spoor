import { describe, it, expect, afterEach } from 'vitest';
import { placeCaretAtEnd, placeCaretAtOffset } from '../../src/utils/placeCaretAtEnd';

describe('placeCaretAtEnd', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('collapses the selection at the end of the element contents', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.textContent = '你好世界';
    document.body.appendChild(el);

    placeCaretAtEnd(el);

    const sel = window.getSelection();
    expect(sel?.rangeCount).toBe(1);
    const range = sel!.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    const atTextEnd =
      range.endContainer === el.firstChild && range.endOffset === '你好世界'.length;
    const atElementEnd = range.endContainer === el && range.endOffset === el.childNodes.length;
    expect(atTextEnd || atElementEnd).toBe(true);
  });

  it('places the caret at the end of a textarea value', () => {
    const el = document.createElement('textarea');
    el.value = '等等';
    document.body.appendChild(el);

    placeCaretAtEnd(el);

    expect(el.selectionStart).toBe(2);
    expect(el.selectionEnd).toBe(2);
  });

  it('placeCaretAtOffset puts the caret at a clamped index without requiring scroll', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.textContent = '你好世界';
    document.body.appendChild(el);

    placeCaretAtOffset(el, 2);

    const sel = window.getSelection();
    expect(sel?.rangeCount).toBe(1);
    const range = sel!.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    expect(range.startContainer).toBe(el.firstChild);
    expect(range.startOffset).toBe(2);
  });
});
