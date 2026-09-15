import { describe, expect, it } from 'vitest';
import { extractAskToolsFromReply, stripOpenAskToolFence } from '../../src/utils/askTools';
import { visibleAiReplyText } from '../../src/utils/visibleAiReply';

describe('extractAskToolsFromReply', () => {
  it('parses a ```search fence after prose', () => {
    const raw = [
      '先看这几份材料。',
      '',
      '```search',
      '{"query":"量子计算","scopes":["webpage"]}',
      '```',
    ].join('\n');
    const { prose, searches, images } = extractAskToolsFromReply(raw);
    expect(prose.trim()).toBe('先看这几份材料。');
    expect(images).toEqual([]);
    expect(searches).toEqual([{ query: '量子计算', scopes: ['webpage'] }]);
  });

  it('defaults omitted scopes to webpage + image', () => {
    const { searches } = extractAskToolsFromReply(
      '```search\n{"query":"FDE 尽调"}\n```',
    );
    expect(searches[0]?.scopes).toEqual(['webpage', 'image']);
  });

  it('treats a plain-text search fence as the query', () => {
    const { searches } = extractAskToolsFromReply('```search\nForward Deployment Engineer\n```');
    expect(searches[0]?.query).toBe('Forward Deployment Engineer');
    expect(searches[0]?.scopes).toEqual(['webpage', 'image']);
  });

  it('does not treat 围栏 as a retrieval query', () => {
    expect(extractAskToolsFromReply('```search\n围栏\n```').searches).toEqual([]);
    expect(
      extractAskToolsFromReply('```search\n{"query":"围栏","scopes":["webpage"]}\n```').searches,
    ).toEqual([]);
  });

  it('parses a search tool_call and still extracts draw', () => {
    const raw = [
      '配一张图，再找来源。',
      '[<tool_call> {"name":"search","arguments":{"query":"Hugging Face","scope":"webpage"}}</tool_call>',
      '```draw',
      '{"images":[{"title":"鸟居","prompt":"a red torii gate in mist"}]}',
      '```',
    ].join('\n');
    const { prose, searches, images } = extractAskToolsFromReply(raw);
    expect(prose.trim()).toBe('配一张图，再找来源。');
    expect(searches[0]?.query).toBe('Hugging Face');
    expect(images[0]?.title).toBe('鸟居');
  });

  it('expands scopes all', () => {
    const { searches } = extractAskToolsFromReply(
      '```search\n{"query":"古着","scopes":["all"]}\n```',
    );
    expect(searches[0]?.scopes).toEqual(['webpage', 'image', 'video', 'podcast']);
  });

  it('strips MiniMax think blocks from prose', () => {
    const raw = [
      '<think>我们需要回答中文。应该用检索工具。</think>',
      '',
      '《1984》是乔治·奥威尔的反乌托邦小说。',
      '',
      '```search',
      '{"query":"1984 乔治·奥威尔 小说","scopes":["webpage","image"]}',
      '```',
    ].join('\n');
    const { prose, searches } = extractAskToolsFromReply(raw);
    expect(prose).not.toContain('<think>');
    expect(prose).toContain('《1984》是乔治·奥威尔的反乌托邦小说。');
    expect(searches[0]?.query).toContain('1984');
  });
});

describe('stripOpenAskToolFence', () => {
  it('hides an unclosed search fence while streaming', () => {
    expect(stripOpenAskToolFence('正文\n```search\n{"query"')).toBe('正文');
  });
});

describe('visibleAiReplyText', () => {
  it('strips search and draw JSON so TTS and the card never show them', () => {
    const raw = [
      '答案如下。',
      '```search',
      '{"query":"熵"}',
      '```',
      '```draw',
      '{"images":[{"title":"图","prompt":"a lantern"}]}',
      '```',
    ].join('\n');
    expect(visibleAiReplyText(raw).trim()).toBe('答案如下。');
  });

  it('strips the voice speak fence so the card never shows the TTS gist', () => {
    const raw = ['```speak', '概况一句。', '```', '', '答案如下。'].join('\n');
    expect(visibleAiReplyText(raw).trim()).toBe('答案如下。');
  });

  it('unwraps a sole markdown fence so a character sheet is not a clipped <pre>', () => {
    const inner = ['【宇宙接驳】', '**核心病灶**: 边界', '> 痛苦在蚕食墙', '- 形态：水母'].join('\n');
    expect(visibleAiReplyText(['```markdown', inner, '```'].join('\n'))).toBe(inner);
    expect(visibleAiReplyText(['```', inner, '```'].join('\n'))).toBe(inner);
  });

  it('does not unwrap a real code sample fence', () => {
    const raw = ['```python', 'print("hi")', '```'].join('\n');
    expect(visibleAiReplyText(raw).trim()).toBe(raw);
  });
});
