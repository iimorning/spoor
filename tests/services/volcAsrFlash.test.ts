import { beforeEach, describe, expect, it, vi } from 'vitest';

const isServerManaged = vi.fn(() => false);
const isTauriRuntime = vi.fn(() => false);

vi.mock('../../src/lib/serverConfig', () => ({
  isServerManaged: () => isServerManaged(),
  getFunctionsBase: () => 'https://example.supabase.co/functions/v1',
  resolveAccessToken: async () => 'jwt',
  edgeFunctionHeaders: (token: string, init?: Record<string, string>) => ({
    Authorization: `Bearer ${token}`,
    apikey: 'anon',
    ...(init ?? {}),
  }),
}));

vi.mock('../../src/utils/isTauriRuntime', () => ({
  isTauriRuntime: () => isTauriRuntime(),
}));

import { transcribeAudioUrlWithVolcFlash } from '../../src/services/volcAsrFlash';

describe('transcribeAudioUrlWithVolcFlash', () => {
  beforeEach(() => {
    isServerManaged.mockReturnValue(false);
    isTauriRuntime.mockReturnValue(false);
  });

  it('POSTs original bytes as base64 to the Vite flash proxy', async () => {
    const wavHeader = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'data:audio/wav;base64,xx') {
        return new Response(wavHeader, { status: 200, headers: { 'content-type': 'audio/wav' } });
      }
      expect(url).toBe('/api/volc-asr/recognize-flash');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.apiKey).toBe('k');
      expect(body.format).toBe('wav');
      expect(typeof body.data).toBe('string');
      expect(body.data.length).toBeGreaterThan(0);
      return new Response(JSON.stringify({ text: 'hello file' }), { status: 200 });
    });

    const text = await transcribeAudioUrlWithVolcFlash(
      { apiKey: 'k' },
      'data:audio/wav;base64,xx',
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(text).toBe('hello file');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses the Edge flash function when server-managed without local keys', async () => {
    isServerManaged.mockReturnValue(true);
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://cdn.example/a.mp3') {
        return new Response(bytes, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      }
      expect(url).toBe('https://example.supabase.co/functions/v1/ai-volc-asr-flash');
      return new Response(JSON.stringify({ text: 'hosted' }), { status: 200 });
    });

    const text = await transcribeAudioUrlWithVolcFlash({}, 'https://cdn.example/a.mp3', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(text).toBe('hosted');
  });
});
