import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateFluxDevImage,
  generateGptImage2,
  hasFlux302Credentials,
  imageKeysFromAiConfig,
} from '../../src/services/flux302';
import { GPT_IMAGE_TIMEOUT_MS, IMAGE_GEN_ERROR } from '../../src/utils/imageGenerationWait';

describe('hasFlux302Credentials', () => {
  it('requires a non-empty 302 or OpenRouter key', () => {
    expect(hasFlux302Credentials(undefined)).toBe(false);
    expect(hasFlux302Credentials('  ')).toBe(false);
    expect(hasFlux302Credentials('sk-x')).toBe(true);
    expect(hasFlux302Credentials('', 'sk-or')).toBe(true);
    expect(hasFlux302Credentials(undefined, '  ')).toBe(false);
  });

  it('imageKeysFromAiConfig uses the LLM key only when provider is openrouter', () => {
    expect(imageKeysFromAiConfig({ provider: 'gemini', apiKey: 'sk-g', api302Key: 'sk-302' })).toEqual({
      apiKey: 'sk-302',
      openrouterApiKey: '',
    });
    expect(imageKeysFromAiConfig({ provider: 'openrouter', apiKey: 'sk-or', api302Key: '' })).toEqual({
      apiKey: '',
      openrouterApiKey: 'sk-or',
    });
  });
});

describe('generateFluxDevImage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses Flux-2-Klein-4b sync response (Ready + sample)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 't-1',
        status: 'Ready',
        result: {
          sample: 'https://file.302ai.cn/gpt/imgs/a.jpg',
          prompt: 'a red apple',
          seed: 1,
        },
      }),
    });

    const result = await generateFluxDevImage({ apiKey: 'sk-test', prompt: 'a red apple' });
    expect(result).toEqual({
      url: 'https://file.302ai.cn/gpt/imgs/a.jpg',
      taskId: 't-1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/flux/v1/flux-2-klein-4b');
    const body = JSON.parse(String(init.body));
    expect(body.sync).toBe(true);
    expect(body.prompt).toBe('a red apple');
  });

  it('falls back to get_result polling when sync only returns an id', async () => {
    vi.useFakeTimers();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 't-2',
          polling_url: 'https://example/poll',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 't-2', status: 'Pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 't-2',
          status: 'Ready',
          result: { sample: 'https://file.302ai.cn/done.jpg' },
        }),
      });

    const pending = generateFluxDevImage({ apiKey: 'sk-test', prompt: 'lantern' });
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1600);
    const result = await pending;
    expect(result.url).toBe('https://file.302ai.cn/done.jpg');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/flux/v1/get_result?id=t-2');
  });
});

describe('generateGptImage2', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calls /v1/images/generations with gpt-image-2 and returns url', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ url: 'https://file.302.ai/gpt/imgs/test.jpg' }],
      }),
    });

    const result = await generateGptImage2({ apiKey: 'sk-test', prompt: 'a red apple' });
    expect(result).toEqual({ url: 'https://file.302.ai/gpt/imgs/test.jpg' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/images/generations');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-image-2');
    expect(body.prompt).toBe('a red apple');
    expect(body.size).toBe('1536x1024');
  });

  it('prefers OpenRouter Images API when openrouterApiKey is set', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ b64_json: 'orimg' }],
      }),
    });

    const result = await generateGptImage2({
      apiKey: 'sk-302',
      openrouterApiKey: 'sk-or',
      prompt: 'a red apple',
    });
    expect(result.url).toBe('data:image/jpeg;base64,orimg');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/openrouter/images');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('google/gemini-3.1-flash-image');
    expect(body.aspect_ratio).toBe('3:2');
    expect(body.resolution).toBe('1K');
    expect(body.quality).toBeUndefined();
    expect(body.output_format).toBeUndefined();
    expect(body.size).toBeUndefined();
    expect(body.input_references).toBeUndefined();
  });

  it('requests strip presets as 1:8 at 2K on OpenRouter', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'strip' }] }),
    });
    await generateGptImage2({
      apiKey: '',
      openrouterApiKey: 'sk-or',
      prompt: 'vertical scroll poster',
      orientation: 'strip',
    });
    const body = JSON.parse(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    expect(body.aspect_ratio).toBe('1:8');
    expect(body.resolution).toBe('2K');
  });

  it('sends OpenRouter input_references when canvas stills are provided', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'orimg' }] }),
    });
    const ref = 'data:image/png;base64,abc';
    await generateGptImage2({
      apiKey: 'sk-302',
      openrouterApiKey: 'sk-or',
      prompt: 'same character waving',
      inputReferences: [ref],
    });
    const body = JSON.parse(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    expect(body.input_references).toEqual([{ type: 'image_url', image_url: { url: ref } }]);
    expect(body.prompt).toMatch(/reference image/i);
  });

  it('falls back to base64 data url when no http url is returned', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ b64_json: 'abc123' }],
      }),
    });

    const result = await generateGptImage2({ apiKey: 'sk-test', prompt: 'lantern' });
    expect(result.url).toBe('data:image/jpeg;base64,abc123');
  });

  it('aborts a hung request after GPT_IMAGE_TIMEOUT_MS and throws timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const fail = () => {
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail);
      });
    });

    const pending = generateGptImage2({ apiKey: 'sk-test', prompt: 'a corridor' });
    const assertion = expect(pending).rejects.toThrow(IMAGE_GEN_ERROR.timeout);
    await vi.advanceTimersByTimeAsync(GPT_IMAGE_TIMEOUT_MS);
    await assertion;
    vi.useRealTimers();
  });
});

// ─── Server-managed path (logged-in + useServerKeys) ────────────────────
describe.skip('flux302 — server-managed', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let setServerConfigFn: typeof import('../../src/lib/serverConfig').setServerConfig;

  beforeEach(async () => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const mod = await import('../../src/lib/serverConfig');
    setServerConfigFn = mod.setServerConfig;
    setServerConfigFn({
      session: {
        access_token: 'jwt-img',
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

  it('generateFluxDevImage POSTs to ai-image Edge Function with bearer auth', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://cdn.example/sample.jpg', taskId: 'sync' }),
    });
    const result = await generateFluxDevImage({ apiKey: 'never-leak', prompt: 'sunset' });
    expect(result.url).toBe('https://cdn.example/sample.jpg');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co/functions/v1/ai-image');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-img');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.provider).toBe('flux');
    expect(body.prompt).toBe('sunset');
    expect(typeof body.locale).toBe('string');
  });

  it('maps prompt_blocked from ai-image to IMAGE_GEN_ERROR.blocked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'prompt_blocked', message: 'not allowed' }),
    });
    await expect(generateFluxDevImage({ apiKey: 'never-leak', prompt: 'bad' })).rejects.toThrow(
      IMAGE_GEN_ERROR.blocked,
    );
  });

  it('maps OpenAI safety rejection from ai-image 502 to IMAGE_GEN_ERROR.blocked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'image_generation_failed',
        message:
          'OpenRouter GPT-Image failed (HTTP 400): Your request was rejected by the safety system.',
      }),
    });
    await expect(generateGptImage2({ apiKey: 'never-leak', prompt: 'poison' })).rejects.toThrow(
      IMAGE_GEN_ERROR.blocked,
    );
  });

  it('maps Gemini content-filter 502 to IMAGE_GEN_ERROR.blocked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'image_generation_failed',
        message:
          'OpenRouter GPT-Image failed (HTTP 400): Gemini blocked this request through content filters.',
      }),
    });
    await expect(generateGptImage2({ apiKey: 'never-leak', prompt: 'poison apple' })).rejects.toThrow(
      IMAGE_GEN_ERROR.blocked,
    );
  });

  it('generateGptImage2 routes through ai-image Edge Function', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://cdn.example/gpt.jpg' }),
    });
    const result = await generateGptImage2({ apiKey: 'never-leak', prompt: 'apple' });
    expect(result.url).toBe('https://cdn.example/gpt.jpg');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.provider).toBe('gpt-image-2');
    expect(body.model).toBe('google/gemini-3.1-flash-image');
  });

  it('forwards input_references to ai-image', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://cdn.example/gpt.jpg', upstream: 'openrouter' }),
    });
    const ref = 'https://cdn.example/ref.jpg';
    await generateGptImage2({
      apiKey: 'never-leak',
      prompt: 'apple',
      inputReferences: [ref],
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.input_references).toEqual([ref]);
  });

  it('hasFlux302Credentials returns true in server-managed mode even with empty key', async () => {
    expect(hasFlux302Credentials(undefined)).toBe(true);
    expect(hasFlux302Credentials('')).toBe(true);
    expect(hasFlux302Credentials('sk-local')).toBe(true);
  });
});
