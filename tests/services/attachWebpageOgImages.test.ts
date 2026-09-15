import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectWebpageOgImages } from '../../src/services/attachWebpageOgImages';
import { fetchPageHtml } from '../../src/services/fetchPageHtml';
import { isBlockedFetchHost } from '../../vite-plugins/fetchPageProxyPlugin';

vi.mock('../../src/services/fetchPageHtml', () => ({
  fetchPageHtml: vi.fn(),
}));

const htmlMock = vi.mocked(fetchPageHtml);

describe('isBlockedFetchHost', () => {
  it('blocks loopback and private ranges', () => {
    expect(isBlockedFetchHost('localhost')).toBe(true);
    expect(isBlockedFetchHost('127.0.0.1')).toBe(true);
    expect(isBlockedFetchHost('10.0.0.1')).toBe(true);
    expect(isBlockedFetchHost('192.168.1.2')).toBe(true);
    expect(isBlockedFetchHost('172.16.0.1')).toBe(true);
    expect(isBlockedFetchHost('book.douban.com')).toBe(false);
  });
});

describe('collectWebpageOgImages', () => {
  beforeEach(() => {
    htmlMock.mockReset();
  });

  it('maps og:image onto image hits and skips fetch failures', async () => {
    htmlMock.mockImplementation(async (url) => {
      if (url.includes('ok')) {
        return {
          finalUrl: url,
          contentType: 'text/html',
          body: `<meta property="og:image" content="/covers/xu.jpg" />`,
        };
      }
      throw new Error('blocked');
    });
    const images = await collectWebpageOgImages([
      { title: '我是许凉凉', link: 'https://book.example/ok', snippet: '', score: '', date: '' },
      { title: 'Nope', link: 'https://book.example/fail', snippet: '', score: '', date: '' },
    ]);
    expect(images).toEqual([
      {
        title: '我是许凉凉',
        link: 'https://book.example/ok',
        imageUrl: 'https://book.example/covers/xu.jpg',
      },
    ]);
  });
});
