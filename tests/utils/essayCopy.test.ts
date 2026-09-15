import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyTextToClipboard } from '../../src/utils/copyTextToClipboard';
import { formatEssayCopyText } from '../../src/utils/formatEssayCopyText';

describe('formatEssayCopyText', () => {
  it('joins title with readable body, lists, and image alt', () => {
    expect(
      formatEssayCopyText({
        title: 'Alpha Unique Title',
        markdown: ['# Section', '', 'Hello **world**.', '', '- one', '- two', '', '![配图](spoor-article-media:img1)'].join(
          '\n',
        ),
      }),
    ).toBe(['Alpha Unique Title', 'Section', 'Hello world.', '• one\n• two', '[配图]'].join('\n\n'));
  });

  it('returns an empty string when both title and body are blank', () => {
    expect(formatEssayCopyText({ title: '  ', markdown: '' })).toBe('');
  });
});

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyTextToClipboard('hello body');
    expect(writeText).toHaveBeenCalledWith('hello body');
  });

  it('falls back to a hidden textarea copy', async () => {
    vi.stubGlobal('navigator', {});
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    await copyTextToClipboard('fallback text');
    expect(exec).toHaveBeenCalledWith('copy');
  });
});
