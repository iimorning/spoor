import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadImageUrl,
  illustrationDownloadFilename,
  imageHrefToDataUrl,
  isAiGeneratedImageNode,
  sameOriginCdnProxyUrl,
} from '../../src/utils/aiGeneratedImage';

describe('isAiGeneratedImageNode', () => {
  it('is true when aiGenerated is set', () => {
    expect(
      isAiGeneratedImageNode({
        type: 'image',
        aiGenerated: true,
        content: 'https://file.example/a.jpg',
      }),
    ).toBe(true);
  });

  it('is false for web-search image cards', () => {
    expect(
      isAiGeneratedImageNode({
        type: 'image',
        content: 'https://cdn.example/a.jpg',
        sourceUrl: 'https://example.com/page',
        webSearchParentId: 'ai-1',
        webSearchIndex: 0,
      }),
    ).toBe(false);
  });

  it('treats legacy generated cards (sourceUrl equals image url, not a search hit) as generated', () => {
    expect(
      isAiGeneratedImageNode({
        type: 'image',
        content: 'https://file.302ai.cn/a.jpg',
        sourceUrl: 'https://file.302ai.cn/a.jpg',
      }),
    ).toBe(true);
  });
});

describe('illustrationDownloadFilename', () => {
  it('keeps CJK and falls back to illustration.jpg', () => {
    expect(illustrationDownloadFilename('科技教育全景')).toBe('科技教育全景.jpg');
    expect(illustrationDownloadFilename('   ')).toBe('illustration.jpg');
  });
});

describe('sameOriginCdnProxyUrl', () => {
  it('maps 302 file CDNs to prefixes that do not collide with /api/302', () => {
    expect(sameOriginCdnProxyUrl('https://file.302ai.cn/gpt/imgs/a.jpg')).toBe(
      '/api/file-302cn/gpt/imgs/a.jpg',
    );
    expect(sameOriginCdnProxyUrl('https://file.302.ai/gpt/imgs/test.jpg?x=1')).toBe(
      '/api/file-302ai/gpt/imgs/test.jpg?x=1',
    );
  });

  it('leaves unrelated URLs unproxied', () => {
    expect(sameOriginCdnProxyUrl('https://cdn.example/a.jpg')).toBeNull();
    expect(sameOriginCdnProxyUrl('data:image/png;base64,abc')).toBeNull();
    expect(sameOriginCdnProxyUrl('not a url')).toBeNull();
  });
});

describe('downloadImageUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function stubDownloadDom(blobUrl = 'blob:spoor-dl') {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(blobUrl);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { click };
  }

  it('fetches 302 CDN images via the same-origin proxy, not the remote host', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const { click } = stubDownloadDom();

    await downloadImageUrl('https://file.302ai.cn/gpt/imgs/a.jpg', '席琳看着我的脖子.jpg');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/file-302cn/gpt/imgs/a.jpg');
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:spoor-dl');
  });

  it('falls back to the original URL when the proxy fetch fails', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    stubDownloadDom();

    await downloadImageUrl('https://file.302.ai/gpt/imgs/test.jpg', 'illustration.jpg');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/file-302ai/gpt/imgs/test.jpg');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://file.302.ai/gpt/imgs/test.jpg');
  });
});

describe('imageHrefToDataUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns existing data URLs unchanged', async () => {
    const data = 'data:image/png;base64,abc';
    expect(await imageHrefToDataUrl(data)).toBe(data);
  });

  it('fetches http images into a data URL', async () => {
    const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/jpeg' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }),
    );
    const out = await imageHrefToDataUrl('https://cdn.example/a.jpg');
    expect(out).toMatch(/^data:image\/jpeg;base64,/);
  });
});
