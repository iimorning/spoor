import { describe, expect, it } from 'vitest';
import {
  applyHostedSsePayload,
  applyLlmStreamDelta,
  createLlmStreamAcc,
  llmStreamTranscript,
  wrapMessageReasoning,
} from '../../src/utils/llmReasoningStream';
import { extractThinkingText, stripThinking } from '../../src/utils/stripThinking';

const TO = '<' + 'think>';
const TC = '</' + 'think>';

describe('llmReasoningStream', () => {
  it('passes content-only deltas through unchanged', () => {
    const acc = createLlmStreamAcc();
    expect(applyLlmStreamDelta(acc, { content: '你好' })).toBe('你好');
    expect(applyLlmStreamDelta(acc, { content: '世界' })).toBe('你好世界');
  });

  it('wraps reasoning_content so the canvas can stream CoT', () => {
    const acc = createLlmStreamAcc();
    const first = applyLlmStreamDelta(acc, { reasoning_content: '先看题' });
    expect(first).toBe(`${TO}先看题${TC}`);
    expect(extractThinkingText(first)).toBe('先看题');
    expect(stripThinking(first)).toBe('');

    const mixed = applyLlmStreamDelta(acc, { content: '答案是42' });
    expect(mixed).toBe(`${TO}先看题${TC}答案是42`);
    expect(extractThinkingText(mixed)).toBe('');
    expect(stripThinking(mixed)).toBe('答案是42');
  });

  it('accepts reasoning / reasoning_text aliases', () => {
    const a = createLlmStreamAcc();
    applyLlmStreamDelta(a, { reasoning: 'A' });
    expect(llmStreamTranscript(a)).toBe(`${TO}A${TC}`);

    const b = createLlmStreamAcc();
    applyLlmStreamDelta(b, { reasoning_text: 'B' });
    expect(llmStreamTranscript(b)).toBe(`${TO}B${TC}`);
  });

  it('ignores null reasoning_content used by DeepSeek after thinking ends', () => {
    const acc = createLlmStreamAcc();
    applyLlmStreamDelta(acc, { reasoning_content: '想' });
    expect(applyLlmStreamDelta(acc, { reasoning_content: null, content: '答' })).toBe(
      `${TO}想${TC}答`,
    );
  });

  it('accumulates hosted { delta, reasoning } payloads', () => {
    const acc = createLlmStreamAcc();
    expect(applyHostedSsePayload(acc, { reasoning: '推理' })).toBe(`${TO}推理${TC}`);
    expect(applyHostedSsePayload(acc, { delta: '正文' })).toBe(`${TO}推理${TC}正文`);
  });

  it('wraps a finished message the same way', () => {
    expect(wrapMessageReasoning('正文', '推理')).toBe(`${TO}推理${TC}正文`);
    expect(wrapMessageReasoning('正文', '')).toBe('正文');
  });
});
