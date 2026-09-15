import { describe, it, expect, beforeEach } from 'vitest';
import {
  compactTtsText,
  findCompactSentenceInHaystack,
  unwrapTtsMarks,
  wrapTtsSentenceInElement,
  TTS_FOLLOW_MARK_ATTR,
} from '../../src/utils/ttsFollowAlongDom';

describe('compactTtsText', () => {
  it('strips markdown table pipes and heading hashes so speech can match rendered cells', () => {
    expect(compactTtsText('| 前期准备 | 必须配备法务 |')).toBe('前期准备必须配备法务');
    expect(compactTtsText('## 一、FDE实施全流程')).toBe('一、FDE实施全流程');
  });
});

describe('findCompactSentenceInHaystack', () => {
  it('finds a spoken table row inside concatenated cell text', () => {
    const compact = compactTtsText('前期准备必须配备懂教培监管的法务下一步');
    const hit = findCompactSentenceInHaystack(compact, '| 前期准备 | 必须配备懂教培监管的法务 |');
    expect(hit).toEqual({ start: 0, end: compactTtsText('前期准备必须配备懂教培监管的法务').length });
  });

  it('returns null when the sentence is absent', () => {
    expect(findCompactSentenceInHaystack('只有这一句。', '另一句。')).toBeNull();
  });
});

describe('wrapTtsSentenceInElement', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('wraps a sentence in a single text node', () => {
    root.textContent = '第一句。第二句。第三句。';
    const mark = wrapTtsSentenceInElement(root, '第二句。');
    expect(mark).not.toBeNull();
    expect(root.querySelector(`[${TTS_FOLLOW_MARK_ATTR}]`)?.textContent).toBe('第二句。');
  });

  it('wraps across table cells when TTS still has pipe syntax', () => {
    root.innerHTML = '<table><tr><td>前期准备</td><td>必须配备懂教培监管的法务</td></tr></table>';
    const mark = wrapTtsSentenceInElement(root, '| 前期准备 | 必须配备懂教培监管的法务 |');
    expect(mark).not.toBeNull();
    const marks = [...root.querySelectorAll(`[${TTS_FOLLOW_MARK_ATTR}]`)];
    expect(marks.map((m) => m.textContent).join('')).toBe('前期准备必须配备懂教培监管的法务');
    expect(root.querySelector('table')).toBeTruthy();
    expect(root.textContent).not.toMatch(/\|/);
  });

  it('unwrap restores original text nodes', () => {
    root.textContent = '你好世界。继续说。';
    wrapTtsSentenceInElement(root, '你好世界。');
    unwrapTtsMarks(root);
    expect(root.querySelector(`[${TTS_FOLLOW_MARK_ATTR}]`)).toBeNull();
    expect(root.textContent).toBe('你好世界。继续说。');
  });

  it('keeps the previous mark when the next spoken chunk is not in the DOM', () => {
    root.textContent = '第一句。第二句。';
    wrapTtsSentenceInElement(root, '第一句。');
    expect(root.querySelector(`[${TTS_FOLLOW_MARK_ATTR}]`)?.textContent).toBe('第一句。');
    wrapTtsSentenceInElement(root, '| --- | --- |');
    expect(root.querySelector(`[${TTS_FOLLOW_MARK_ATTR}]`)?.textContent).toBe('第一句。');
  });
});
