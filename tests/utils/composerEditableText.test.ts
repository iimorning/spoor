import { afterEach, describe, expect, it } from 'vitest';
import {
  isComposerCaretPlaceholder,
  readComposerEditableOffset,
  readComposerEditableText,
} from '../../src/utils/composerEditableText';

function host(html: string): HTMLElement {
  const el = document.createElement('span');
  el.contentEditable = 'true';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function setCaret(el: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe('composerEditableText', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps typed newlines in a single text node', () => {
    const el = host('');
    el.textContent = '第一行\n第二行';
    expect(readComposerEditableText(el)).toBe('第一行\n第二行');
  });

  it('maps br and block lines to newlines', () => {
    expect(readComposerEditableText(host('上<br>下'))).toBe('上\n下');
    expect(readComposerEditableText(host('hello<div>world</div>'))).toBe('hello\nworld');
  });

  it('treats a lone caret br as empty, not a typed newline', () => {
    const el = host('<br>');
    expect(isComposerCaretPlaceholder(el)).toBe(true);
    expect(readComposerEditableText(el)).toBe('');
    expect(readComposerEditableOffset(el)).toBe(0);
  });

  it('does not treat a real newline text node as a placeholder', () => {
    const el = host('');
    el.textContent = '\n';
    expect(isComposerCaretPlaceholder(el)).toBe(false);
    expect(readComposerEditableText(el)).toBe('\n');
  });

  it('counts caret offset after a br, unlike Range.toString()', () => {
    const el = host('hello<br>world');
    const world = el.childNodes[2]!;
    setCaret(el, world, 0);
    expect(readComposerEditableOffset(el)).toBe('hello\n'.length);
    const prefix = document.createRange();
    prefix.selectNodeContents(el);
    prefix.setEnd(world, 0);
    expect(prefix.toString().length).toBe('hello'.length);
  });
});
