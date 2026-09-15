import { describe, expect, it } from 'vitest';
import {
  DRAW_PROMPT_MAX_LEN,
  extractDrawToolFromReply,
  stripOpenDrawFence,
} from '../../src/utils/drawTool';
import { visibleAiReplyText } from '../../src/utils/visibleAiReply';

describe('extractDrawToolFromReply', () => {
  it('keeps plain prose unchanged', () => {
    expect(extractDrawToolFromReply('只是文字')).toEqual({
      prose: '只是文字',
      images: [],
    });
  });

  it('parses a ```draw fence after prose', () => {
    const raw = [
      '教室里的光很安静。',
      '',
      '```draw',
      '{"images":[{"title":"教室","prompt":"1980s Japanese classroom, afternoon light, chalk dust"}]}',
      '```',
    ].join('\n');
    const { prose, images } = extractDrawToolFromReply(raw);
    expect(prose.trim()).toBe('教室里的光很安静。');
    expect(images).toEqual([
      {
        title: '教室',
        prompt: '1980s Japanese classroom, afternoon light, chalk dust',
      },
    ]);
  });

  it('parses orientation on a draw spec', () => {
    const { images } = extractDrawToolFromReply(
      '```draw\n{"images":[{"title":"席琳","prompt":"standing woman in a hospital bed","orientation":"portrait"}]}\n```',
    );
    expect(images[0]).toEqual({
      title: '席琳',
      prompt: 'standing woman in a hospital bed',
      orientation: 'portrait',
    });
  });

  it('parses a trailing draw JSON object', () => {
    const raw = '先把结构说清楚。\n{"images":[{"title":"结构","prompt":"a simple diagram of nested boxes"}]}';
    const { prose, images } = extractDrawToolFromReply(raw);
    expect(prose.trim()).toBe('先把结构说清楚。');
    expect(images[0]?.title).toBe('结构');
  });

  it('parses a draw tool_call and ignores search tool_call', () => {
    const draw = extractDrawToolFromReply(
      '配一张图。\n[<tool_call> {"name":"draw","arguments":{"prompt":"a red torii gate in mist","title":"鸟居"}}',
    );
    expect(draw.prose.trim()).toBe('配一张图。');
    expect(draw.images[0]?.prompt).toContain('torii');

    const search = extractDrawToolFromReply(
      '我去搜一下。\n[<tool_call> {"name":"search","arguments":{"query":"Hugging Face"}}',
    );
    expect(search.images).toEqual([]);
    expect(search.prose).toContain('[<tool_call>');
  });

  it('does not treat book-expand JSON as a draw request', () => {
    const raw =
      '{"hub":"主题","branches":[{"title":"一","content":"内容一"},{"title":"二","content":"内容二"}],"images":[{"title":"图","prompt":"a map"}]}';
    const { prose, images } = extractDrawToolFromReply(raw);
    expect(images).toEqual([]);
    expect(prose).toContain('"hub"');
  });

  it('caps at four images', () => {
    const { images } = extractDrawToolFromReply(
      '```draw\n{"images":[{"title":"a","prompt":"one"},{"title":"b","prompt":"two"},{"title":"c","prompt":"three"},{"title":"d","prompt":"four"},{"title":"e","prompt":"five"}]}\n```',
    );
    expect(images).toHaveLength(4);
  });

  it('keeps a long poster prompt (title copy + visual style)', () => {
    const body = '海报标题「深夜酒店」glitch RGB '.repeat(50).trim();
    expect(body.length).toBeGreaterThan(500);
    expect(body.length).toBeLessThan(DRAW_PROMPT_MAX_LEN);
    const { images } = extractDrawToolFromReply(
      `\`\`\`draw\n{"images":[{"title":"海报","prompt":${JSON.stringify(body)}}]}\n\`\`\``,
    );
    expect(images[0]?.prompt).toBe(body);
  });
});

describe('stripOpenDrawFence', () => {
  it('hides an unclosed draw fence while streaming', () => {
    expect(stripOpenDrawFence('正文\n```draw\n{"images"')).toBe('正文');
  });
});

describe('visibleAiReplyText', () => {
  it('strips draw JSON so TTS and the card never show it', () => {
    const raw = '答案如下。\n```draw\n{"images":[{"title":"图","prompt":"a lantern"}]}\n```';
    expect(visibleAiReplyText(raw).trim()).toBe('答案如下。');
  });
});
