import { describe, expect, it } from 'vitest';
import {
  dedupeAskSearchHits,
  formatAskSearchHitsForModel,
  formatSearchHitCanvasMarkdown,
  formatSearchHitEssayMarkdown,
  hitsEligibleForAskSynthesis,
  isChatVisibleSearchHit,
  mergeAskSearchHits,
  searchHitHostname,
  type AskSearchHit,
} from '../../src/utils/askSearchHits';

describe('askSearchHits', () => {
  it('dedupes by link/title and caps count', () => {
    const hits: AskSearchHit[] = [
      { kind: 'webpage', query: 'a', title: 'One', snippet: 's', link: 'https://a' },
      { kind: 'webpage', query: 'a', title: 'One', snippet: 's2', link: 'https://a' },
      { kind: 'webpage', query: 'b', title: 'Two', snippet: 't', link: 'https://b' },
    ];
    expect(dedupeAskSearchHits(hits)).toHaveLength(2);
  });

  it('requires text-bearing hits for synthesis eligibility', () => {
    expect(
      hitsEligibleForAskSynthesis([
        { kind: 'image', query: 'x', title: 'pic', snippet: '', link: 'https://img' },
      ]),
    ).toBe(true);
    expect(
      hitsEligibleForAskSynthesis([
        { kind: 'image', query: 'x', title: '', snippet: '', imageUrl: 'https://img' },
      ]),
    ).toBe(false);
    expect(
      hitsEligibleForAskSynthesis([
        { kind: 'webpage', query: 'x', title: 'Article', snippet: 'detail', link: 'https://x' },
      ]),
    ).toBe(true);
  });

  it('formats catalog for the synthesis prompt', () => {
    const text = formatAskSearchHitsForModel([
      {
        kind: 'webpage',
        query: 'cats',
        title: 'Cat facts',
        snippet: 'They meow.',
        link: 'https://example.com',
      },
    ]);
    expect(text).toContain('Cat facts');
    expect(text).toContain('They meow.');
    expect(text).toContain('https://example.com');
  });

  it('mergeAskSearchHits keeps more hits than synthesis cap', () => {
    const hits: AskSearchHit[] = Array.from({ length: 15 }, (_, i) => ({
      kind: 'webpage',
      query: 'q',
      title: `T${i}`,
      snippet: 's',
      link: `https://h${i}.example`,
    }));
    expect(dedupeAskSearchHits(hits)).toHaveLength(10);
    expect(mergeAskSearchHits([], hits)).toHaveLength(15);
  });

  it('hides the live-search brief from the chat list', () => {
    expect(
      isChatVisibleSearchHit({
        kind: 'webpage',
        query: 'q',
        title: 'Live search brief',
        snippet: 'engine summary',
      }),
    ).toBe(false);
  });

  it('extracts hostname for source rows', () => {
    expect(searchHitHostname('https://www.tech.qq.com/a/1.html')).toBe('tech.qq.com');
  });

  it('formats a webpage hit as canvas markdown', () => {
    expect(
      formatSearchHitCanvasMarkdown({
        kind: 'webpage',
        query: 'moon',
        title: '月球有多老',
        snippet: '45.1亿年',
        link: 'https://tech.qq.com/a.html',
        date: '2023年01月01日',
      }),
    ).toBe('### 月球有多老\n\n2023年01月01日\n\n45.1亿年');
  });

  it('formats a webpage hit as editor markdown with the source link', () => {
    expect(
      formatSearchHitEssayMarkdown({
        kind: 'webpage',
        query: 'moon',
        title: '月球有多老',
        snippet: '45.1亿年',
        link: 'https://tech.qq.com/a.html',
        date: '2023年01月01日',
      }),
    ).toBe('### 月球有多老\n\n2023年01月01日\n\n45.1亿年\n\nhttps://tech.qq.com/a.html');
  });

  it('formats an image hit as an editor image', () => {
    expect(
      formatSearchHitEssayMarkdown({
        kind: 'image',
        query: 'cover',
        title: 'Cover',
        snippet: '',
        imageUrl: 'https://img.example/c.jpg',
        link: 'https://img.example/page',
      }),
    ).toBe('![Cover](https://img.example/c.jpg)\n\n[Cover](https://img.example/page)');
  });
});
