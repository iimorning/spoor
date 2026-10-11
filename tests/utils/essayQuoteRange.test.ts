import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { findQuoteRange } from '../../src/utils/essayQuoteRange';
import { compactTtsText } from '../../src/utils/ttsFollowAlongDom';

/**
 * 位置算错了的话，返回的 from/to 会指向别处，甚至抛 "Position out of range"。
 * 所以这里不验证"算出来的数字等于我以为的数字"，而是**往返验证**：把返回的范围
 * 读回来，去掉空白之后必须等于引文本身。数字怎么算的都无所谓，读得回来才算对。
 */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    heading: { content: 'text*', group: 'block' },
    text: {},
  },
});

function docOf(markdown: string): PmNode {
  const blocks = markdown
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((chunk) => {
      const heading = chunk.startsWith('# ');
      return schema.nodes[heading ? 'heading' : 'paragraph'].create(
        null,
        chunk.replace(/^# /, '') ? schema.text(chunk.replace(/^# /, '')) : undefined,
      );
    });
  return schema.nodes.doc.create(null, blocks);
}

const DOC_MARKDOWN = [
  '# 模型中转站OpenRouter入门',
  '',
  '接你写的东西，不是接模型。像OpenRouter聚合了',
  '几十家端点，比自己配省事，但陷阱得知道。',
  '',
  '比如deepseek官方端点没有报价。',
].join('\n');

describe('findQuoteRange', () => {
  const doc = docOf(DOC_MARKDOWN);

  it('找到一句，回读出来就是那句', () => {
    const quote = '但陷阱得知道';
    const range = findQuoteRange(doc, quote);
    expect(range).not.toBeNull();
    const readBack = doc.textBetween(range!.from, range!.to, '\n', '\n');
    expect(compactTtsText(readBack)).toBe(compactTtsText(quote));
  });

  it('引文里的空白和换行被模型归一化过，也能对上', () => {
    // 模型复制时经常顺手压掉换行和缩进，那不算错，定位要照样成立。
    const range = findQuoteRange(doc, '比如deepseek官方端点没有报价');
    expect(range).not.toBeNull();
    const readBack = doc.textBetween(range!.from, range!.to, '\n', '\n');
    expect(compactTtsText(readBack)).toBe(compactTtsText('比如deepseek官方端点没有报价'));
  });

  it('正文里没有这句话就返回 null，不猜', () => {
    expect(findQuoteRange(doc, '这句话根本不在正文里出现过')).toBeNull();
  });

  it('空引文返回 null', () => {
    expect(findQuoteRange(doc, '')).toBeNull();
    expect(findQuoteRange(doc, '   \n  ')).toBeNull();
  });

  it('跨段落定位到正确的位置', () => {
    const span = docOf('第一段落。\n\n第二段落。');
    const range = findQuoteRange(span, '第一段落。第二段落。');
    expect(range).not.toBeNull();
    const readBack = span.textBetween(range!.from, range!.to, '\n', '\n');
    expect(compactTtsText(readBack)).toBe(compactTtsText('第一段落。第二段落。'));
  });

  it('标题里的句子同样能定位', () => {
    const range = findQuoteRange(doc, '模型中转站OpenRouter入门');
    expect(range).not.toBeNull();
  });
});

describe('findQuoteRange 的唯一性', () => {
  it('同一句出现两次就拒绝，而不是标错一处', () => {
    // 标错一处比不标更糟：用户会以为那是他特意强调的。
    const twice = docOf('这句话他说了两遍。\n\n这句话他说了两遍。');
    expect(findQuoteRange(twice, '这句话他说了两遍')).toBeNull();
  });

  it('出现三次同样拒绝', () => {
    const thrice = docOf('重复。\n\n重复。\n\n重复。');
    expect(findQuoteRange(thrice, '重复')).toBeNull();
  });

  it('同一段里出现两次，但引文取长了就仍然唯一', () => {
    // 唯一性看的是**引文**本身，不是里面某几个字。取全句就不撞车。
    const twice = docOf('这句话他说了。后来他重复了一遍：这句话他说了。');
    expect(findQuoteRange(twice, '这句话他说了')).toBeNull();
    expect(findQuoteRange(twice, '后来他重复了一遍：这句话他说了')).not.toBeNull();
  });
});

describe('findQuoteRange 在真实 ProseMirror 状态上', () => {
  it('往返仍然成立', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('第一段写的是甲。')),
      schema.nodes.paragraph.create(null, schema.text('第二段写的是乙。')),
    ]);
    const state = EditorState.create({ schema, doc });
    const range = findQuoteRange(state.doc, '第二段写的是乙。');
    expect(range).not.toBeNull();
    expect(state.doc.textBetween(range!.from, range!.to, '\n', '\n')).toBe('第二段写的是乙。');
  });
});
