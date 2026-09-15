import { describe, it, expect } from 'vitest';
import {
  countEssayChars,
  essayBodyMarkdown,
  essayPlainText,
  isSourceSegmentInBody,
} from '../../src/utils/essayWordCount';

describe('essayWordCount', () => {
  it('strips markdown chrome and counts non-whitespace characters', () => {
    expect(essayPlainText('## Hello **world**')).toBe('Hello world');
    expect(countEssayChars('## Hello **world**')).toBe(10);
  });

  it('counts Chinese characters as 字数', () => {
    expect(countEssayChars('在试验了一些效果之后')).toBe(10);
  });

  it('does not count image markdown or surrounding whitespace', () => {
    expect(countEssayChars('前言 ![封面](https://example.com/a.png)\n\n正文')).toBe(4);
  });

  it('keeps link labels, drops the URL', () => {
    expect(countEssayChars('见[说明](https://example.com)')).toBe(3);
  });

  it('joins sourceCards when present, otherwise uses content', () => {
    expect(
      essayBodyMarkdown({
        content: 'ignored',
        sourceCards: [{ segmentText: '甲段' }, { segmentText: '乙段' }],
      }),
    ).toBe('甲段\n\n乙段');
    expect(essayBodyMarkdown({ content: '整篇' })).toBe('整篇');
    expect(countEssayChars(essayBodyMarkdown({
      sourceCards: [
        { segmentText: '第一段文字' },
        { segmentText: '第二段' },
      ],
    }))).toBe(8);
  });

  it('falls back to content when every sourceCard segment is empty', () => {
    expect(
      essayBodyMarkdown({
        content: '模型写好的整篇',
        sourceCards: [{ segmentText: '' }, { segmentText: '   ' }],
      }),
    ).toBe('模型写好的整篇');
  });

  it('skips unlinked source cards when joining the body', () => {
    expect(
      essayBodyMarkdown({
        content: 'fallback',
        sourceCards: [
          { segmentText: 'inbox only', inBody: false },
          { segmentText: 'in the article' },
        ],
      }),
    ).toBe('in the article');
  });

  it('detects image and text segments in live body markdown', () => {
    const imageSegment = '![cover](spoor-article-media:img-1)';
    const body = `Intro\n\n${imageSegment}\n\nOutro`;
    expect(isSourceSegmentInBody(imageSegment, body)).toBe(true);
    expect(isSourceSegmentInBody('![other](spoor-article-media:missing)', body)).toBe(false);
    expect(isSourceSegmentInBody('quoted line', 'before quoted line after')).toBe(true);
  });

  it('uses content when contentDrivesBody, even if sourceCards remain', () => {
    expect(
      essayBodyMarkdown({
        content: '手改后的正文',
        contentDrivesBody: true,
        sourceCards: [{ segmentText: '旧分段' }],
      }),
    ).toBe('手改后的正文');
  });
});
