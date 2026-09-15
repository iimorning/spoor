import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  metasoSearch,
  buildSearchContext,
  resolveMetasoImageUrl,
  normalizeMetasoSearchResponse,
  resolveMetasoScope,
} from '../../src/services/search';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('metasoSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSearchContext', () => {
    it('empty webpages returns empty string', () => {
      const result = buildSearchContext({ credits: 0, total: 0, webpages: [] });
      expect(result).toBe('');
    });

    it('formats webpages into context block', () => {
      const result = buildSearchContext({
        credits: 1,
        total: 2,
        webpages: [
          { title: 'Article A', link: 'https://a.com', snippet: 'Snippet A', score: 'high', date: '2026-01-01' },
          { title: 'Article B', link: 'https://b.com', snippet: 'Snippet B', score: 'medium', date: '2026-02-01' },
        ],
      });
      expect(result).toContain('[Source 1: Article A](https://a.com)');
      expect(result).toContain('Snippet A');
      expect(result).toContain('[Source 2: Article B](https://b.com)');
      expect(result).toContain('Snippet B');
      expect(result).toContain('--- Web search results ---');
      expect(result).toContain('--- End of search results ---');
    });

    it('handles missing webpages array gracefully', () => {
      const result = buildSearchContext({ credits: 0, total: 0 } as any);
      expect(result).toBe('');
    });

    it('formats image results into context block', () => {
      const result = buildSearchContext({
        credits: 1,
        total: 1,
        webpages: [],
        images: [{ title: 'Mt Fuji', link: 'https://page.example/fuji', thumbnail: 'https://cdn.example/fuji.jpg' }],
      });
      expect(result).toContain('[Image 1: Mt Fuji](https://cdn.example/fuji.jpg)');
      expect(result).toContain('Page: https://page.example/fuji');
    });
  });

  describe('resolveMetasoImageUrl', () => {
    it('prefers Metaso imageUrl over thumbnail/link', () => {
      expect(
        resolveMetasoImageUrl({
          imageUrl: 'https://cdn.example/real.jpg',
          thumbnail: 'https://cdn.example/thumb.jpg',
          link: 'https://page.example',
        }),
      ).toBe('https://cdn.example/real.jpg');
    });

    it('prefers thumbnail over bare page link', () => {
      expect(
        resolveMetasoImageUrl({
          link: 'https://page.example',
          thumbnail: 'https://cdn.example/a.jpg',
        }),
      ).toBe('https://cdn.example/a.jpg');
    });
  });

  describe('resolveMetasoScope', () => {
    it('accepts video and podcast', () => {
      expect(resolveMetasoScope('video')).toBe('video');
      expect(resolveMetasoScope('podcast')).toBe('podcast');
      expect(resolveMetasoScope('unknown')).toBe('webpage');
    });
  });

  describe('normalizeMetasoSearchResponse', () => {
    it('maps imageUrl / sourceUrl from Metaso image payloads', () => {
      const normalized = normalizeMetasoSearchResponse({
        credits: 1,
        total: 1,
        images: [
          {
            title: '古着',
            imageUrl: 'https://img.example/vintage.jpg',
            sourceUrl: 'https://page.example/article',
          },
        ],
      });
      expect(normalized.images).toHaveLength(1);
      expect(resolveMetasoImageUrl(normalized.images![0]!)).toBe('https://img.example/vintage.jpg');
      expect(normalized.images![0]!.link).toBe('https://page.example/article');
    });

    it('maps nested webpages / url / summary', () => {
      const normalized = normalizeMetasoSearchResponse({
        data: {
          webpages: [
            {
              title: '一九八四',
              url: 'https://zh.wikipedia.org/wiki/一九八四',
              summary: '短摘要',
            },
          ],
        },
      });
      expect(normalized.webpages).toHaveLength(1);
      expect(normalized.webpages[0]?.link).toContain('wikipedia');
      expect(normalized.webpages[0]?.snippet).toBe('短摘要');
    });

    it('maps videos and podcasts arrays', () => {
      const normalized = normalizeMetasoSearchResponse({
        credits: 1,
        total: 2,
        videos: [
          {
            title: 'Vintage haul',
            link: 'https://video.example/1',
            channel: 'Style',
            duration: 125,
            snippet: 'A lookbook',
          },
        ],
        podcasts: [
          {
            title: 'Fashion history',
            url: 'https://pod.example/ep1',
            host: 'Ada',
            podcastName: 'Cloth Talk',
            duration: 3661,
          },
        ],
      });
      expect(normalized.videos).toHaveLength(1);
      expect(normalized.videos![0]).toMatchObject({
        title: 'Vintage haul',
        link: 'https://video.example/1',
        authors: 'Style',
        duration: '2:05',
      });
      expect(normalized.podcasts).toHaveLength(1);
      expect(normalized.podcasts![0]).toMatchObject({
        title: 'Fashion history',
        link: 'https://pod.example/ep1',
        authors: 'Ada',
        showName: 'Cloth Talk',
        duration: '1:01:01',
      });
    });
  });

  describe('metasoSearch - browser path', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('throws on empty API key', async () => {
      await expect(
        metasoSearch('test query', { apiKey: '' })
      ).rejects.toThrow('Metaso API key is empty');
    });

    it('throws on whitespace-only API key', async () => {
      await expect(
        metasoSearch('test query', { apiKey: '   ' })
      ).rejects.toThrow('Metaso API key is empty');
    });

    it('calls Vite proxy endpoint with correct params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          credits: 1,
          total: 1,
          webpages: [{ title: 'Test', link: 'https://test.com', snippet: 'Hello', score: 'high', date: '2026-01-01' }],
        }),
      });

      const result = await metasoSearch('AI research', { apiKey: 'sk-metaso-test' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/metaso/api/v1/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-metaso-test',
          }),
          body: JSON.stringify({
            q: 'AI research',
            scope: 'webpage',
            size: '5',
            includeSummary: false,
            conciseSnippet: true,
          }),
        })
      );
      expect(result.webpages).toHaveLength(1);
      expect(result.webpages[0].title).toBe('Test');
    });

    it('calls proxy with image scope when requested', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          credits: 1,
          total: 1,
          images: [{ title: 'Cat', link: 'https://img.example/cat.jpg', thumbnail: 'https://img.example/cat-t.jpg' }],
        }),
      });

      const result = await metasoSearch('cat', { apiKey: 'sk-metaso-test', scope: 'image', size: 8 });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/metaso/api/v1/search',
        expect.objectContaining({
          body: JSON.stringify({
            q: 'cat',
            scope: 'image',
            size: '8',
            includeSummary: false,
            conciseSnippet: true,
          }),
        }),
      );
      expect(result.images).toHaveLength(1);
    });

    it('calls proxy with video and podcast scopes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ credits: 1, total: 0, videos: [], podcasts: [] }),
      });

      await metasoSearch('talk', { apiKey: 'sk-metaso-test', scope: 'video', size: 5 });
      expect(mockFetch).toHaveBeenLastCalledWith(
        '/api/metaso/api/v1/search',
        expect.objectContaining({
          body: JSON.stringify({
            q: 'talk',
            scope: 'video',
            size: '5',
            includeSummary: false,
            conciseSnippet: true,
          }),
        }),
      );

      await metasoSearch('talk', { apiKey: 'sk-metaso-test', scope: 'podcast', size: 5 });
      expect(mockFetch).toHaveBeenLastCalledWith(
        '/api/metaso/api/v1/search',
        expect.objectContaining({
          body: JSON.stringify({
            q: 'talk',
            scope: 'podcast',
            size: '5',
            includeSummary: false,
            conciseSnippet: true,
          }),
        }),
      );
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(
        metasoSearch('test', { apiKey: 'bad-key' })
      ).rejects.toThrow('Metaso search HTTP 401');
    });
  });
});

// ─── Server-managed path (logged-in + useServerKeys) ────────────────────
describe.skip('metasoSearch — server-managed', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let setServerConfigFn: typeof import('../../src/lib/serverConfig').setServerConfig;

  beforeEach(async () => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const mod = await import('../../src/lib/serverConfig');
    setServerConfigFn = mod.setServerConfig;
    setServerConfigFn({
      session: {
        access_token: 'jwt-search',
        refresh_token: 'rt',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: { id: 'u1' } as never,
      } as never,
      useServerKeys: true,
      isPro: true,
    });
    (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL =
      'https://example.supabase.co/functions/v1';
  });

  it('POSTs to ai-search Edge Function with bearer auth and no local key in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ credits: 0, total: 0, webpages: [] }),
    });
    const result = await metasoSearch('hello', { apiKey: 'never-leak', size: 5 });
    expect(result.total).toBe(0);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co/functions/v1/ai-search');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-search');
    // The user's apiKey must NOT appear in the body.
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).not.toHaveProperty('apiKey');
    expect(body.q).toBe('hello');
  });

  it('works with an empty local apiKey when server-managed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ credits: 0, total: 0, webpages: [] }),
    });
    await expect(metasoSearch('hi', { apiKey: '' })).resolves.toBeDefined();
  });

  it('throws when the Edge Function returns an HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: 'metaso_not_configured' }),
    });
    await expect(metasoSearch('hi', { apiKey: 'x' })).rejects.toThrow(/Metaso search HTTP 502/);
  });
});
