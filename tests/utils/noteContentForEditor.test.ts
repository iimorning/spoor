import { describe, it, expect } from 'vitest';
import { noteContentForEditor, noteLooksLikeHtml } from '../../src/utils/noteContentForEditor';

describe('noteLooksLikeHtml', () => {
  it('ignores comparisons that are not tags', () => {
    expect(noteLooksLikeHtml('cost < 2 and a > b')).toBe(false);
    expect(noteLooksLikeHtml('**bold**\n\nsecond')).toBe(false);
  });

  it('detects real tags', () => {
    expect(noteLooksLikeHtml('<p>hi</p>')).toBe(true);
    expect(noteLooksLikeHtml('skill就行。<br>单独做')).toBe(true);
  });
});

describe('noteContentForEditor', () => {
  it('leaves markdown source unchanged', () => {
    const raw = '平台。\n而是\nskill就行。\n\n单独做一个AI软件成本很高。';
    expect(noteContentForEditor(raw)).toBe(raw);
  });

  it('turns a trailing HTML paragraph into visible text (preview vs edit mismatch)', () => {
    const raw =
      '平台。\n而是\nskill就行。\n\n<p>单独做一个AI软件成本很高，周期长，会\n有很多东西。</p>';
    const out = noteContentForEditor(raw);
    expect(out).toContain('平台。');
    expect(out).toContain('skill就行。');
    expect(out).toContain('单独做一个AI软件成本很高，周期长，会');
    expect(out).toContain('有很多东西。');
    expect(out).not.toMatch(/<\/?p>/i);
  });

  it('maps <br> to newlines', () => {
    expect(noteContentForEditor('a<br>b<br/>c')).toBe('a\nb\nc');
  });

  it('does not treat empty / null as html', () => {
    expect(noteContentForEditor('')).toBe('');
    expect(noteContentForEditor(null)).toBe('');
    expect(noteContentForEditor(undefined)).toBe('');
  });
});
