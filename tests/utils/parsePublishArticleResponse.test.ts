import { describe, it, expect } from 'vitest';
import {
  parsePublishArticleResponse,
  previewStreamingPublishBody,
  validateSourceCardFidelity,
  assemblePublishBody,
  wrapDeletionsInSource,
} from '../../src/utils/parsePublishArticleResponse';

const FALLBACK = '生成的合成稿';

describe('parsePublishArticleResponse', () => {
  it('解析新 schema: cardText + transitions 数组', () => {
    const raw = JSON.stringify({
      title: '创业的意义是什么？',
      segments: [
        {
          cardId: 'c1',
          cardText: '## 用不确定性交换可能性\n\n正文段落。',
          transitions: ['先说说背景。'],
        },
        {
          cardId: 'c2',
          cardText: '## 第二节\n\n另一段。',
          transitions: ['接下来看几个常见误区。'],
        },
      ],
    });
    const parsed = parsePublishArticleResponse(raw, FALLBACK);
    expect(parsed.title).toBe('创业的意义是什么？');
    expect(parsed.segments).toEqual([
      {
        cardId: 'c1',
        cardText: '## 用不确定性交换可能性\n\n正文段落。',
        transitions: ['先说说背景。'],
        deletions: [],
      },
      {
        cardId: 'c2',
        cardText: '## 第二节\n\n另一段。',
        transitions: ['接下来看几个常见误区。'],
        deletions: [],
      },
    ]);
    // opener (c1 的 transitions) 拼在 c1 之前；c2 的 transitions 拼在 c2 之前（即 c1 与 c2 之间）
    expect(parsed.body).toBe(
      '<mark data-ai-transition="true">先说说背景。</mark>\n\n' +
        '## 用不确定性交换可能性\n\n正文段落。\n\n' +
        '<mark data-ai-transition="true">接下来看几个常见误区。</mark>\n\n' +
        '## 第二节\n\n另一段。',
    );
  });

  it('旧 schema {cardId, text} 仍可解析：text 视作 cardText，transitions 为空', () => {
    const raw = JSON.stringify({
      title: '创业的意义是什么？',
      segments: [
        { cardId: 'c1', text: '## 用不确定性交换可能性\n\n正文段落。' },
        { cardId: 'c2', text: '## 第二节\n\n另一段。' },
      ],
    });
    const parsed = parsePublishArticleResponse(raw, FALLBACK);
    expect(parsed.segments).toEqual([
      { cardId: 'c1', cardText: '## 用不确定性交换可能性\n\n正文段落。', transitions: [], deletions: [] },
      { cardId: 'c2', cardText: '## 第二节\n\n另一段。', transitions: [], deletions: [] },
    ]);
  });

  it('transitions 包含标题/列表/链接/图片时被丢弃', () => {
    // Note: code-fence entries (\`\`\`) are also dropped at the sanitize layer,
    // but `parseLenientLlmJson` strips all backticks before the sanitize layer
    // sees them, so we don't test code-fences via JSON here — see the regex
    // unit checks below.
    const raw = JSON.stringify({
      title: 'T',
      segments: [
        {
          cardId: 'c1',
          cardText: '卡片正文',
          transitions: [
            '正常过渡句。',
            '## 标题过渡（应被丢弃）',
            '- 列表项（应被丢弃）',
            '包含 [link](http://x) 的过渡（应被丢弃）',
            '包含 ![img](http://x) 的过渡（应被丢弃）',
          ],
        },
      ],
    });
    const parsed = parsePublishArticleResponse(raw, FALLBACK);
    expect(parsed.segments[0].transitions).toEqual(['正常过渡句。']);
  });

  it('每段间隙最多保留 2 句过渡；opener 最多 1 句', () => {
    const raw = JSON.stringify({
      title: 'T',
      segments: [
        {
          cardId: 'c1',
          cardText: 'A',
          transitions: ['t1', 't2', 't3', 't4'],
        },
        {
          cardId: 'c2',
          cardText: 'B',
          transitions: ['g1', 'g2', 'g3'],
        },
        {
          cardId: 'c3',
          cardText: 'C',
          transitions: [],
        },
      ],
    });
    const parsed = parsePublishArticleResponse(raw, FALLBACK);
    // c1 的 transitions 是 opener：截到 1 句
    // c2 的 transitions 是 c1→c2 衔接：截到 2 句
    // c3 的 transitions 是 c2→c3 衔接但下面规则下被丢弃
    expect(parsed.body).toBe(
      '<mark data-ai-transition="true">t1</mark>\n\n' +
        'A\n\n' +
        '<mark data-ai-transition="true">g1</mark>\n\n' +
        '<mark data-ai-transition="true">g2</mark>\n\n' +
        'B\n\n' +
        'C',
    );
  });

  it('旧格式 {title, body} 回退为单段 segments（无 transitions）', () => {
    const raw = JSON.stringify({
      title: '创业的意义是什么？',
      body: '## 用不确定性交换可能性\n\n正文段落。',
    });
    expect(parsePublishArticleResponse(raw, FALLBACK)).toEqual({
      title: '创业的意义是什么？',
      body: '## 用不确定性交换可能性\n\n正文段落。',
      segments: [{ cardId: '', cardText: '## 用不确定性交换可能性\n\n正文段落。', transitions: [], deletions: [] }],
    });
  });

  it('JSON 带代码块包裹时仍能解析', () => {
    const raw = '```json\n{"title":"标题A","body":"## 小节\\n\\n内容"}\n```';
    expect(parsePublishArticleResponse(raw, FALLBACK).title).toBe('标题A');
    expect(parsePublishArticleResponse(raw, FALLBACK).body).toContain('## 小节');
  });

  it('非 JSON 时从首个一级标题拆出标题', () => {
    const raw = '# 从 H1 拆出的标题\n\n## 第二节\n\n段落';
    expect(parsePublishArticleResponse(raw, FALLBACK)).toEqual({
      title: '从 H1 拆出的标题',
      body: '## 第二节\n\n段落',
      segments: [{ cardId: '', cardText: '## 第二节\n\n段落', transitions: [], deletions: [] }],
    });
  });

  it('无法解析时使用回退标题并保留全文', () => {
    const raw = '纯段落文字，没有标题结构。';
    expect(parsePublishArticleResponse(raw, FALLBACK)).toEqual({
      title: FALLBACK,
      body: raw,
      segments: [{ cardId: '', cardText: raw, transitions: [], deletions: [] }],
    });
  });
});

describe('validateSourceCardFidelity', () => {
  it('cardText 与源卡片空白归一后一致时不改动', () => {
    const segments = [
      { cardId: 'c1', cardText: 'hello   world', transitions: [] },
      { cardId: 'c2', cardText: 'second', transitions: [] },
    ];
    const overrides = validateSourceCardFidelity(segments, [
      { nodeId: 'c1', markdown: 'hello world' },
      { nodeId: 'c2', markdown: 'second' },
    ]);
    expect(overrides).toBe(0);
    expect(segments[0].cardText).toBe('hello   world');
  });

  it('cardText 被 AI 改写时强制覆盖回源 markdown', () => {
    const segments = [
      { cardId: 'c1', cardText: 'AI 改写过的版本', transitions: [] },
      { cardId: 'c2', cardText: '正常', transitions: [] },
    ];
    const overrides = validateSourceCardFidelity(segments, [
      { nodeId: 'c1', markdown: '原始用户文字' },
      { nodeId: 'c2', markdown: '正常' },
    ]);
    expect(overrides).toBe(1);
    expect(segments[0].cardText).toBe('原始用户文字');
    expect(segments[1].cardText).toBe('正常');
  });

  it('cardId 在源里找不到的段（orphan）跳过比对', () => {
    const segments = [{ cardId: 'orphan', cardText: 'whatever', transitions: [] }];
    const overrides = validateSourceCardFidelity(segments, [
      { nodeId: 'c1', markdown: 'real source' },
    ]);
    expect(overrides).toBe(0);
    expect(segments[0].cardText).toBe('whatever');
  });

  it('does not wipe cardText when the source markdown is empty', () => {
    const segments = [{ cardId: 'c1', cardText: '模型写好的段落', transitions: [] }];
    const overrides = validateSourceCardFidelity(segments, [{ nodeId: 'c1', markdown: '' }]);
    expect(overrides).toBe(0);
    expect(segments[0].cardText).toBe('模型写好的段落');
  });

  it('does not wipe cardText when the source is a data URL', () => {
    const segments = [{ cardId: 'c1', cardText: '![封面](https://cdn.example/a.jpg)', transitions: [] }];
    const overrides = validateSourceCardFidelity(segments, [
      { nodeId: 'c1', markdown: 'data:image/png;base64,AAAA' },
    ]);
    expect(overrides).toBe(0);
    expect(segments[0].cardText).toBe('![封面](https://cdn.example/a.jpg)');
  });

  it('does not overwrite image captions when the source is a media:// placeholder', () => {
    const segments = [
      { cardId: 'img1', cardText: '![厨房水槽](media://image/img1)', transitions: [] },
    ];
    const overrides = validateSourceCardFidelity(segments, [
      { nodeId: 'img1', markdown: '![Image](media://image/img1)' },
    ]);
    expect(overrides).toBe(0);
    expect(segments[0].cardText).toBe('![厨房水槽](media://image/img1)');
  });
});

describe('assemblePublishBody', () => {
  it('按约定顺序拼接：opener + cardText + 中间过渡 + cardText + ...', () => {
    // Convention A: transitions[i] 是 segments[i] 之前的衔接。transitions[0] 是 opener，
    // transitions[i] (i>=1) 是 cardText[i-1] 与 cardText[i] 之间的衔接。
    // 没有"trailing"概念：transitions[N-1] 也是衔接，渲染在 cardText[N-1] 之前。
    const parts = [
      { text: 'A', transitions: ['opener'], nodeId: 'c1' },
      { text: 'B', transitions: ['g1', 'g2'], nodeId: 'c2' },
      { text: 'C', transitions: ['g3'], nodeId: 'c3' },
    ];
    const body = assemblePublishBody(parts);
    expect(body).toBe(
      '<mark data-ai-transition="true">opener</mark>\n\n' +
        'A\n\n' +
        '<mark data-ai-transition="true">g1</mark>\n\n' +
        '<mark data-ai-transition="true">g2</mark>\n\n' +
        'B\n\n' +
        '<mark data-ai-transition="true">g3</mark>\n\n' +
        'C',
    );
  });

  it('空数组返回空字符串', () => {
    expect(assemblePublishBody([])).toBe('');
  });
});

describe('previewStreamingPublishBody', () => {
  it('只抽出已闭合的 cardText，忽略半截 JSON', () => {
    const raw =
      '{"title":"T","segments":[{"cardId":"c1","cardText":"第一段已写完","transitions":["}';
    expect(previewStreamingPublishBody(raw)).toBe('第一段已写完');
  });

  it('兼容旧字段 text，并拼接多段', () => {
    const raw =
      '{"segments":[{"text":"A 段"},{"cardText":"B 段"},{"cardText":"未闭合';
    expect(previewStreamingPublishBody(raw)).toBe('A 段\n\nB 段');
  });

  it('半截 JSON 不含完整字符串时返回空，避免把原始 JSON 刷进编辑器', () => {
    expect(previewStreamingPublishBody('{"title":"T","segments":[')).toBe('');
  });
});

describe('wrapDeletionsInSource', () => {
  it('skips snippets that occur more than once', () => {
    expect(wrapDeletionsInSource('你好***世界***再见', ['***'])).toBe('你好***世界***再见');
  });

  it('wraps a unique substring once', () => {
    expect(wrapDeletionsInSource('你好***世界', ['***'])).toBe(
      '你好<mark data-ai-deletion="true">***</mark>世界',
    );
  });

  it('skips snippets that are the entire card', () => {
    expect(wrapDeletionsInSource('整段原文', ['整段原文'])).toBe('整段原文');
  });

  it('assembles deletions next to transitions', () => {
    const body = assemblePublishBody([
      { text: 'Alpha ###', transitions: ['先看这段。'], deletions: [' ###'] },
      { text: 'Beta', transitions: ['接着是下一张。'] },
    ]);
    expect(body).toBe(
      '<mark data-ai-transition="true">先看这段。</mark>\n\n' +
        'Alpha<mark data-ai-deletion="true"> ###</mark>\n\n' +
        '<mark data-ai-transition="true">接着是下一张。</mark>\n\n' +
        'Beta',
    );
  });
});