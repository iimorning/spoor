import { describe, it, expect } from 'vitest';
import {
  parsePublishOutlineResponse,
  serializeOutlineForPrompt,
  orderOutlineSectionsByCardIds,
  asCardOrderOutline,
  mergeOutlineWithSourceCards,
  resolvePublishOutline,
  outlineFromCardIds,
  type PublishOutline,
} from '../../src/utils/parsePublishOutlineResponse';

const FALLBACK = '默认标题';

describe('parsePublishOutlineResponse', () => {
  it('合法 JSON：sections 全字段正常解析', () => {
    const raw = JSON.stringify({
      title: '大纲标题',
      sections: [
        { cardId: 'n1', heading: '引言', summary: '开门见山' },
        { cardId: 'n2', heading: '展开', summary: '主题论述' },
      ],
    });
    expect(parsePublishOutlineResponse(raw, FALLBACK)).toEqual({
      title: '大纲标题',
      sections: [
        { cardId: 'n1', heading: '引言', summary: '开门见山' },
        { cardId: 'n2', heading: '展开', summary: '主题论述' },
      ],
    });
  });

  it('契约：heading 与 summary 都为空的 section 也要保留（与 prompt 契约一致）', () => {
    const raw = JSON.stringify({
      title: 'T',
      sections: [
        { cardId: 'n1', heading: '正面', summary: '有内容' },
        { cardId: 'n2', heading: '', summary: '' },
        { cardId: 'n3', heading: '结尾', summary: '总结' },
      ],
    });
    const parsed = parsePublishOutlineResponse(raw, FALLBACK)!;
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[1]).toEqual({ cardId: 'n2', heading: '', summary: '' });
  });

  it('JSON 中夹杂代码块围栏也能解析', () => {
    const raw = '```json\n{"title":"A","sections":[{"cardId":"x","heading":"H","summary":"S"}]}\n```';
    expect(parsePublishOutlineResponse(raw, FALLBACK)?.title).toBe('A');
  });

  it('非元素段（null / 数组 / 非对象）会被跳过，但合法段保留', () => {
    const raw = JSON.stringify({
      title: 'T',
      sections: [null, [], 'string', { cardId: 'ok', heading: 'H', summary: 'S' }],
    });
    const parsed = parsePublishOutlineResponse(raw, FALLBACK)!;
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].cardId).toBe('ok');
  });

  it('非法 JSON 不再拆成假段落（避免思考过程进大纲）', () => {
    const raw = '# Markdown 大纲\n\n- 第一条\n- 第二条\n';
    expect(parsePublishOutlineResponse(raw, FALLBACK)).toBeNull();
  });

  it('思考块之后的 JSON 仍可解析', () => {
    const raw =
      '<think> Let me analyze the cards and images.\nText cards:\n1. 197576f8 - title</think>\n' +
      JSON.stringify({
        title: '毛衣',
        sections: [{ cardId: 'n1' }, { cardId: 'n2' }],
      });
    expect(parsePublishOutlineResponse(raw, FALLBACK)).toEqual({
      title: '毛衣',
      sections: [
        { cardId: 'n1', heading: '', summary: '' },
        { cardId: 'n2', heading: '', summary: '' },
      ],
    });
  });

  it('只有思考过程时返回 null', () => {
    const raw = '<think> Let me analyze the cards and images.\nText cards:</think>';
    expect(parsePublishOutlineResponse(raw, FALLBACK)).toBeNull();
  });

  it('空字符串 / 纯空白 → 返回 null', () => {
    expect(parsePublishOutlineResponse('', FALLBACK)).toBeNull();
    expect(parsePublishOutlineResponse('   \n  ', FALLBACK)).toBeNull();
  });

  it('合法 JSON 但 sections 缺失 → 返回 null', () => {
    const raw = JSON.stringify({ title: '孤零零' });
    expect(parsePublishOutlineResponse(raw, FALLBACK)).toBeNull();
  });

  it('mergeOutlineWithSourceCards 把漏卡插到选中顺序中的后继之前', () => {
    const merged = mergeOutlineWithSourceCards(
      {
        title: 'T',
        sections: [
          { cardId: 'img1', heading: '', summary: '' },
          { cardId: 'invented', heading: '', summary: '' },
        ],
      },
      ['n1', 'img1', 'n2'],
    );
    expect(merged.sections.map((s) => s.cardId)).toEqual(['n1', 'img1', 'n2']);
  });

  it('mergeOutlineWithSourceCards 漏掉的中间卡不堆到末尾', () => {
    const merged = mergeOutlineWithSourceCards(
      {
        title: 'T',
        sections: [
          { cardId: 'n3', heading: '', summary: '' },
          { cardId: 'n1', heading: '', summary: '' },
        ],
      },
      ['n1', 'n2', 'n3'],
    );
    expect(merged.sections.map((s) => s.cardId)).toEqual(['n2', 'n3', 'n1']);
  });

  it('resolvePublishOutline 在 parse 为 null 时回退到选中顺序', () => {
    expect(resolvePublishOutline(null, 'T', ['n2', 'n1']).sections.map((s) => s.cardId)).toEqual([
      'n2',
      'n1',
    ]);
  });

  it('outlineFromCardIds 按选中顺序生成可读大纲', () => {
    expect(outlineFromCardIds('T', ['n2', 'n1', 'n2', ''])).toEqual({
      title: 'T',
      sections: [
        { cardId: 'n2', heading: '', summary: '' },
        { cardId: 'n1', heading: '', summary: '' },
      ],
    });
  });

  it('serializeOutlineForPrompt 给每段加上【cardId:】前缀与从 1 开始的序号', () => {
    const outline: PublishOutline = {
      title: '示例',
      sections: [
        { cardId: 'n1', heading: '引言', summary: '开门' },
        { cardId: '', heading: '新增段', summary: '' },
      ],
    };
    const text = serializeOutlineForPrompt(outline);
    expect(text.startsWith('# 示例')).toBe(true);
    expect(text).toContain('【cardId:n1】1. n1');
    expect(text).toContain('2. 新增段');
    expect(text.indexOf('【cardId:n1】')).toBeLessThan(text.indexOf('2. 新增段'));
    expect(text).not.toContain('开门');
  });

  it('asCardOrderOutline 丢掉模型写的 heading/summary，空位保留 heading', () => {
    const outline: PublishOutline = {
      title: 'T',
      sections: [
        { cardId: 'n1', heading: '改写过的小标题', summary: '概括原文' },
        { cardId: '', heading: '空位', summary: '不该留下' },
      ],
    };
    expect(asCardOrderOutline(outline)).toEqual({
      title: 'T',
      sections: [
        { cardId: 'n1', heading: '', summary: '' },
        { cardId: '', heading: '空位', summary: '' },
      ],
    });
  });

  it('orderOutlineSectionsByCardIds 按叠卡 / 选中顺序重排', () => {
    const outline: PublishOutline = {
      title: 'T',
      sections: [
        { cardId: 'c', heading: '尾', summary: '' },
        { cardId: 'a', heading: '头', summary: '' },
        { cardId: 'b', heading: '中', summary: '' },
      ],
    };
    expect(orderOutlineSectionsByCardIds(outline, ['a', 'b', 'c']).sections.map((s) => s.cardId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
