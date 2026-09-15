import { describe, it, expect } from 'vitest';
import { stripThinking, extractThinkingText, extractCompletedThinking } from '../../src/utils/stripThinking';

// Build tags from parts so the literal sequences survive being written to disk.
const LT = '<';
const GT = '>';
const SL = '/';
const TO = LT + 'think' + GT;
const TC = LT + SL + 'think' + GT;
const WO = LT + 'thought' + GT;
const WC = LT + SL + 'thought' + GT;

describe('stripThinking', () => {
  it('returns text unchanged when no thinking tag present', () => {
    expect(stripThinking('你好，世界')).toBe('你好，世界');
  });

  it('returns empty while inside an open think block', () => {
    expect(stripThinking(TO + '让我想想')).toBe('');
  });

  it('returns content after think closes', () => {
    expect(stripThinking(TO + '思考' + TC + '答案是42')).toBe('答案是42');
  });

  it('handles thought / close-thought style', () => {
    expect(stripThinking(WO + '思考结束' + WC + '最终答案')).toBe('最终答案');
  });

  it('handles multiple think blocks', () => {
    expect(stripThinking(TO + '一' + TC + TO + '二' + TC + '第二段回答')).toBe('第二段回答');
  });

  it('preserves leading whitespace after close', () => {
    expect(stripThinking(TO + 'x' + TC + '  你好')).toBe('  你好');
  });

  it('returns empty for empty input', () => {
    expect(stripThinking('')).toBe('');
  });

  it('passes plain answer through unchanged', () => {
    expect(stripThinking('普通回答')).toBe('普通回答');
  });

  it('strips MiniMax namespace token and tool_call chrome after prose', () => {
    const prose = '我来帮你搜索一下关于这件事的信息。';
    const leaked =
      prose +
      '\n]<]minimax[>\n[<tool_call> {"name": "search", "arguments": {"query": "Hugging Face"}}';
    expect(stripThinking(leaked).trim()).toBe(prose);
  });

  it('strips full MiniMax ns_token-prefixed tool_call block', () => {
    const prose = '答案如下。';
    const ns = ']<]minimax[>[';
    const leaked = `${prose}\n${ns}<tool_call>\n${ns}<invoke name="search">\n${ns}</tool_call>`;
    expect(stripThinking(leaked).trim()).toBe(prose);
  });

  it('hides incomplete tool_call while streaming', () => {
    expect(stripThinking('前言\n[<tool_call> {"name":').trim()).toBe('前言');
  });
});

describe('extractThinkingText', () => {
  it('returns inner think text while the block is still open', () => {
    expect(extractThinkingText(TO + '先看看问题')).toBe('先看看问题');
  });

  it('returns the closed think block until visible prose starts', () => {
    expect(extractThinkingText(TO + '推理完毕' + TC)).toBe('推理完毕');
  });

  it('returns empty once visible prose has started', () => {
    expect(extractThinkingText(TO + '推理' + TC + '答案是42')).toBe('');
  });
});

describe('extractCompletedThinking', () => {
  it('keeps think text after visible prose starts', () => {
    expect(extractCompletedThinking(TO + '推理' + TC + '答案是42')).toBe('推理');
  });

  it('joins multiple think blocks', () => {
    expect(extractCompletedThinking(TO + '一' + TC + TO + '二' + TC + '答')).toBe('一\n\n二');
  });

  it('returns empty when there is no thinking block', () => {
    expect(extractCompletedThinking('普通回答')).toBe('');
  });
});
