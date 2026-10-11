import { describe, expect, it } from 'vitest';
import { partialJsonStringField } from '../../src/utils/partialJsonField';

/**
 * 划词翻译改流式之后，浮层要把「还没收完的 JSON」剥成译文显示。所以这里的用例
 * 几乎全都是**残缺文本**：每加一个字符都必须能多认出一点，中途还不能闪出转义符。
 */
describe('partialJsonStringField', () => {
  it('认出已经到齐的译文', () => {
    expect(partialJsonStringField('{"translation":"媒体","note":""}', 'translation')).toBe('媒体');
  });

  it('只吐了信封的头，一个字都还没到', () => {
    expect(partialJsonStringField('{"trans', 'translation')).toBe('');
    expect(partialJsonStringField('{"translation":', 'translation')).toBe('');
    expect(partialJsonStringField('{"translation":"', 'translation')).toBe('');
  });

  it('随着字符到达逐步变长', () => {
    const whole = '{"translation":"媒体","note":""}';
    const seen: string[] = [];
    for (let i = 0; i < whole.length; i += 1) {
      seen.push(partialJsonStringField(whole.slice(0, i), 'translation'));
    }
    // 任何一步都不能比上一步短——上一帧还在的字不该在下一帧消失。
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].length).toBeGreaterThanOrEqual(seen[i - 1].length);
    }
    expect(seen[seen.length - 1]).toBe('媒体');
  });

  it('末尾停在半个转义上时不把反斜杠露出去', () => {
    // 这几种都会在下一帧变成完整转义，中间的帧不能闪出一个 \。
    expect(partialJsonStringField('{"translation":"他说\\', 'translation')).toBe('他说');
    expect(partialJsonStringField('{"translation":"他说\\"', 'translation')).toBe('他说"');
    expect(partialJsonStringField('{"translation":"x\\u', 'translation')).toBe('x');
    expect(partialJsonStringField('{"translation":"x\\u4', 'translation')).toBe('x');
    expect(partialJsonStringField('{"translation":"x\\u4e2', 'translation')).toBe('x');
  });

  it('解开完整的转义', () => {
    expect(partialJsonStringField('{"translation":"a\\nb"}', 'translation')).toBe('a\nb');
    expect(partialJsonStringField('{"translation":"引号\\"在里面"}', 'translation')).toBe('引号"在里面');
    expect(partialJsonStringField('{"translation":"\\u4e2d\\u6587"}', 'translation')).toBe('中文');
    expect(partialJsonStringField('{"translation":"反斜杠\\\\"}', 'translation')).toBe('反斜杠\\');
  });

  it('键名冒号之间可以有空隙', () => {
    expect(partialJsonStringField('{ "translation" : "媒体"', 'translation')).toBe('媒体');
    expect(partialJsonStringField('{\n  "translation"\t:\n"媒体"', 'translation')).toBe('媒体');
  });

  it('译文里出现键名同名词不算数', () => {
    // 值里的 "note" 后面不是冒号，不能被当成键。
    const raw = '{"translation":"他说 note 是空的","note":"真的空"}';
    expect(partialJsonStringField(raw, 'translation')).toBe('他说 note 是空的');
  });

  it('键在译文值之后才出现时，取的还是第一个', () => {
    // 提示词约定了 translation 在前；这里锁住这个约定，格式一改就会红。
    expect(partialJsonStringField('{"note":"x","translation":"媒体"}', 'translation')).toBe('媒体');
  });

  it('值不是字符串（比如模型把值写成了数字）时不硬拆', () => {
    expect(partialJsonStringField('{"translation":42}', 'translation')).toBe('');
    expect(partialJsonStringField('{"translation":null}', 'translation')).toBe('');
  });

  it('空文本和不存在的键都还回空串', () => {
    expect(partialJsonStringField('', 'translation')).toBe('');
    expect(partialJsonStringField('{"note":"x"}', 'translation')).toBe('');
    expect(partialJsonStringField('{"translation":"a"}', '')).toBe('');
  });

  it('模型吐的非法转义不会吞掉后面的字', () => {
    // \ 后面跟个字母不是合法 JSON。解析器到这里已经崩了，但显示不能跟着崩。
    expect(partialJsonStringField('{"translation":"a\\qb"}', 'translation')).toBe('aqb');
  });
});