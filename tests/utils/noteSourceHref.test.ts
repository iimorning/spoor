import { describe, expect, it } from 'vitest';
import {
  noteContentWithoutTrailingSourceUrl,
  resolveNoteSourceHref,
  trailingHttpUrl,
} from '../../src/utils/noteSourceHref';

describe('trailingHttpUrl', () => {
  it('reads a bare URL on the last line', () => {
    expect(trailingHttpUrl('### 1. Title\n\nhttps://baike.baidu.com/item/x')).toBe(
      'https://baike.baidu.com/item/x',
    );
  });

  it('reads duplicated markdown links', () => {
    const url = 'https://www.thepaper.cn/newsDetail_forward_1';
    expect(trailingHttpUrl(`hello\n\n[${url}](${url})`)).toBe(url);
  });
});

describe('resolveNoteSourceHref', () => {
  it('prefers sourceUrl', () => {
    expect(
      resolveNoteSourceHref({
        sourceUrl: 'https://ex.com/a',
        content: 'https://other.com',
      }),
    ).toBe('https://ex.com/a');
  });
});

describe('noteContentWithoutTrailingSourceUrl', () => {
  it('drops a trailing URL line', () => {
    expect(
      noteContentWithoutTrailingSourceUrl(
        '### 1. Title\n\nhttps://ex.com/a',
        'https://ex.com/a',
      ),
    ).toBe('### 1. Title');
  });
});
