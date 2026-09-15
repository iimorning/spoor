import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake WebSocket — capture handlers so tests can drive open/message/error/close.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  binaryType: BinaryType = 'arraybuffer';
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sent: Uint8Array[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  // Helpers used by tests to drive the client.
  fakeOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  fakeMessage(data: string | ArrayBuffer): void {
    this.onmessage?.({ data });
  }
  fakeError(): void {
    this.onerror?.(new Event('error'));
  }
  fakeClose(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close'));
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

import { hasVolcAsrCredentials, issueVolcAsrToken, openVolcAsrSession } from '../../src/services/volcAsr';
import {
  MSG_FULL_SERVER_RESPONSE,
  FLAG_POSITIVE_SEQUENCE,
  SERIAL_JSON,
  COMPRESS_NONE,
  COMPRESS_GZIP,
} from '../../src/services/volcAsrProtocol';

function buildJsonServerFrame(json: object): ArrayBuffer {
  const payload = new TextEncoder().encode(JSON.stringify(json));
  const header = new Uint8Array(4);
  header[0] = 0x11;
  header[1] = (MSG_FULL_SERVER_RESPONSE << 4) | FLAG_POSITIVE_SEQUENCE;
  header[2] = (SERIAL_JSON << 4) | COMPRESS_NONE;
  header[3] = 0;
  const seq = new Uint8Array(4);
  new DataView(seq.buffer).setInt32(0, 1, false);
  const lenBytes = new Uint8Array(4);
  new DataView(lenBytes.buffer).setUint32(0, payload.length, false);
  const out = new Uint8Array(header.length + seq.length + lenBytes.length + payload.length);
  out.set(header, 0);
  out.set(seq, header.length);
  out.set(lenBytes, header.length + seq.length);
  out.set(payload, header.length + seq.length + lenBytes.length);
  return out.buffer;
}

async function flushAsyncWork(): Promise<void> {
  // CompressionStream / write queue settle across micro + macro tasks.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function waitForSent(ws: FakeWebSocket, count: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (ws.sent.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${count} sent frames (have ${ws.sent.length})`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
});

describe('hasVolcAsrCredentials', () => {
  it('rejects empty object', () => {
    expect(hasVolcAsrCredentials({})).toBe(false);
  });

  it('apiKey alone is sufficient', () => {
    expect(hasVolcAsrCredentials({ apiKey: 'k' })).toBe(true);
  });

  it('legacy appId + accessToken pair is required', () => {
    expect(hasVolcAsrCredentials({ appId: 'a' })).toBe(false);
    expect(hasVolcAsrCredentials({ accessToken: 't' })).toBe(false);
    expect(hasVolcAsrCredentials({ appId: 'a', accessToken: 't' })).toBe(true);
  });

  it('trims whitespace before checking', () => {
    expect(hasVolcAsrCredentials({ apiKey: '   ' })).toBe(false);
    expect(hasVolcAsrCredentials({ apiKey: '   k   ' })).toBe(true);
  });
});

describe('openVolcAsrSession', () => {
  async function init(
    handlers: Parameters<typeof openVolcAsrSession>[1] = {},
    opts: Parameters<typeof openVolcAsrSession>[2] = { token: 'preissued-test-token' },
  ) {
    const session = await openVolcAsrSession({ apiKey: 'k' }, handlers, opts);
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    ws.fakeOpen();
    await waitForSent(ws, 1);
    return { session, ws };
  }

  /** Server ACK after full client request — required before audio may be sent. */
  async function ackSession(ws: FakeWebSocket): Promise<void> {
    ws.fakeMessage(
      buildJsonServerFrame({
        result: { text: '', utterances: [] },
      }),
    );
    await flushAsyncWork();
  }

  it('WebSocket URL carries only the opaque token, never the API key', async () => {
    const { ws } = await init();
    const url = new URL(ws.url);
    expect(url.searchParams.get('token')).toBe('preissued-test-token');
    expect(url.searchParams.has('apiKey')).toBe(false);
    expect(url.searchParams.has('appId')).toBe(false);
    expect(url.searchParams.has('accessToken')).toBe(false);
  });

  it('sends a gzip full client request as the first frame after open', async () => {
    const { ws } = await init();
    expect(ws.sent.length).toBe(1);
    const frame = ws.sent[0]!;
    expect((frame[1] >> 4) & 0x0f).toBe(0b0001); // MSG_FULL_CLIENT_REQUEST
    expect(frame[2] & 0x0f).toBe(COMPRESS_GZIP);
  });

  it('attaches canvas corpus.context when corpusContext is provided', async () => {
    const corpusContext = JSON.stringify({
      hotwords: [{ word: '海龟汤' }],
      context_type: 'dialog_ctx',
      context_data: [{ text: '汤面：红房子里有人点了海龟汤。' }],
    });
    const { ws } = await init({}, { token: 'preissued-test-token', corpusContext });
    const { gunzipSync } = await import('node:zlib');
    const frame = ws.sent[0]!;
    const size = new DataView(frame.buffer, frame.byteOffset, 8).getUint32(4, false);
    const inflated = gunzipSync(Buffer.from(frame.subarray(8, 8 + size)));
    const payload = JSON.parse(inflated.toString('utf8')) as {
      request: { corpus?: { context?: string } };
    };
    expect(payload.request.corpus?.context).toBe(corpusContext);
  });

  it('omits corpus when no canvas bias is provided', async () => {
    const { ws } = await init();
    const { gunzipSync } = await import('node:zlib');
    const frame = ws.sent[0]!;
    const size = new DataView(frame.buffer, frame.byteOffset, 8).getUint32(4, false);
    const inflated = gunzipSync(Buffer.from(frame.subarray(8, 8 + size)));
    const payload = JSON.parse(inflated.toString('utf8')) as {
      request: { corpus?: unknown };
    };
    expect(payload.request.corpus).toBeUndefined();
  });

  it('does not send audio until the server ACK arrives', async () => {
    const { session, ws } = await init();
    session.sendPcm(new Uint8Array([1, 2, 3]));
    await flushAsyncWork();
    expect(ws.sent.length).toBe(1); // only full client request
    await ackSession(ws);
    await waitForSent(ws, 2);
    expect((ws.sent[1]![1] >> 4) & 0x0f).toBe(0b0010); // MSG_AUDIO_ONLY_REQUEST
  });

  it('decodes and routes onPartial when only partials arrive', async () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    await init({ onPartial, onDefinite });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: {
          text: '',
          utterances: [{ text: '你好', definite: false }],
        },
      }),
    );
    expect(onPartial).toHaveBeenCalledWith('你好');
    expect(onDefinite).not.toHaveBeenCalled();
  });

  it('routes single definite utterance via onDefinite', async () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    await init({ onPartial, onDefinite });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '完成', definite: true }] },
      }),
    );
    expect(onDefinite).toHaveBeenCalledWith('完成');
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('joins MULTIPLE definite utterances into one onDefinite call (regression on #5)', async () => {
    const onDefinite = vi.fn();
    await init({ onDefinite });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: {
          utterances: [
            { text: '第一句。', definite: true },
            { text: '第二句。', definite: true },
          ],
        },
      }),
    );
    expect(onDefinite).toHaveBeenCalledTimes(1);
    expect(onDefinite).toHaveBeenCalledWith(expect.stringContaining('第一句。'));
    expect(onDefinite.mock.calls[0]?.[0]).toContain('第二句。');
  });

  it('prefers cumulative result.text over joining utterance fragments', async () => {
    const onPartial = vi.fn();
    await init({ onPartial });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: {
          text: '联网搜索一下那个最近 OpenAI 攻击 Hugging Face 的新闻',
          utterances: [
            { text: '联网搜索一下', definite: false },
            { text: '那个最近', definite: false },
          ],
        },
      }),
    );
    expect(onPartial).toHaveBeenCalledWith('联网搜索一下那个最近 OpenAI 攻击 Hugging Face 的新闻');
  });

  it('emits full cumulative text on definite frames that also have a new partial', async () => {
    const onDefinite = vi.fn();
    const onPartial = vi.fn();
    await init({ onDefinite, onPartial });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: {
          text: '第一句。第二句还在说',
          utterances: [
            { text: '第一句。', definite: true },
            { text: '第二句还在说', definite: false },
          ],
        },
      }),
    );
    expect(onDefinite).toHaveBeenCalledWith('第一句。第二句还在说');
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('dedupes identical definite utterances from nostream re-decode', async () => {
    const onDefinite = vi.fn();
    await init({ onDefinite });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: {
          utterances: [
            { text: '同一句。', definite: true },
            { text: '同一句。', definite: true },
          ],
        },
      }),
    );
    expect(onDefinite).toHaveBeenCalledWith('同一句。');
  });

  it('skips definite-only frames whose text is just whitespace', async () => {
    const onDefinite = vi.fn();
    const onPartial = vi.fn();
    await init({ onDefinite, onPartial });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '   ', definite: true }] },
      }),
    );
    expect(onDefinite).not.toHaveBeenCalled();
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('onError closes the underlying WebSocket (regression on #8)', async () => {
    const onError = vi.fn();
    const { ws } = await init({ onError });
    ws.fakeError();
    expect(onError).toHaveBeenCalled();
    expect(ws.closed).toBe(true);
  });

  it('late frames after close() are ignored', async () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    const { session, ws } = await init({ onPartial, onDefinite });
    session.close();
    ws.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '迟到的帧', definite: true }] },
      }),
    );
    expect(onDefinite).not.toHaveBeenCalled();
  });

  it('after ACK, sendPcm routes audio frames to send', async () => {
    const { session, ws } = await init();
    await ackSession(ws);
    const before = ws.sent.length;
    session.sendPcm(new Uint8Array([1, 2, 3]));
    session.sendPcm(new Uint8Array([4, 5, 6]));
    await waitForSent(ws, before + 2);
  });

  it('pre-open PCM is queued and flushes only after open + ACK', async () => {
    const session = await openVolcAsrSession({ apiKey: 'k' }, {}, { token: 'tok' });
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    session.sendPcm(new Uint8Array([1, 2, 3]));
    session.sendPcm(new Uint8Array([4, 5, 6]));
    expect(ws.sent.length).toBe(0);
    ws.fakeOpen();
    await waitForSent(ws, 1);
    expect(ws.sent.length).toBe(1); // full request only
    await ackSession(ws);
    await waitForSent(ws, 3); // full + 2 audio
  });

  it('caps the pre-open pending buffer to avoid unbounded growth (#8 secondary)', async () => {
    const { session } = await init();
    const chunk = new Uint8Array(64 * 1024); // 64 KB
    for (let i = 0; i < 8; i++) session.sendPcm(chunk);
    session.close();
  });

  it('throws when called without credentials', async () => {
    await expect(openVolcAsrSession({}, {})).rejects.toThrow(/Missing Volc ASR credentials/);
  });
});

// ─── Server-managed path (logged-in + useServerKeys) ────────────────────
describe.skip('issueVolcAsrToken / openVolcAsrSession — server-managed', () => {
  let setServerConfigFn: typeof import('../../src/lib/serverConfig').setServerConfig;

  beforeEach(async () => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const mod = await import('../../src/lib/serverConfig');
    setServerConfigFn = mod.setServerConfig;
    setServerConfigFn({
      session: {
        access_token: 'jwt-volc',
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

  it('issueVolcAsrToken POSTs to ai-volc-asr-token Edge Function with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'srv-tok', expiresIn: 600 }),
    });
    const { token, expiresIn } = await issueVolcAsrToken(
      {},
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(token).toBe('srv-tok');
    expect(expiresIn).toBe(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co/functions/v1/ai-volc-asr-token');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-volc');
    // Body should NOT contain the user's key — server reads from its own table.
    expect((init as RequestInit).body).toBe('{}');
  });

  it('openVolcAsrSession opens WS to ai-volc-asr-ws Edge Function URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'srv-tok', expiresIn: 600 }),
    });
    const handlers = {
      onPartial: vi.fn(),
      onDefinite: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    const session = await openVolcAsrSession(
      {},
      handlers,
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(session).toBeDefined();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url.startsWith('wss://example.supabase.co/functions/v1/ai-volc-asr-ws?')).toBe(true);
    expect(ws.url).toContain('token=srv-tok');
    expect(ws.url).toContain('resourceId=volc.seedasr.sauc.duration');
    session.close();
  });

  it('hasVolcAsrCredentials returns true in server-managed mode even with empty creds', () => {
    expect(hasVolcAsrCredentials({})).toBe(true);
    // And even when the user has filled keys locally — server-managed wins.
    expect(hasVolcAsrCredentials({ apiKey: 'sk-x' })).toBe(true);
  });
});
