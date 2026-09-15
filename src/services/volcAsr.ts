import {
  VOLC_ASR_DEFAULT_RESOURCE_ID,
  VOLC_ASR_END_WINDOW_MS,
  VOLC_ASR_PROXY_PATH,
} from '../constants/voiceWriting';
import { isServerManaged, getFunctionsBase, resolveAccessToken, edgeFunctionHeaders, withEdgeFunctionWsParams } from '../lib/serverConfig';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import {
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
  parseServerFrame,
  parseServerFrameAsync,
  type VolcAsrUtterance,
} from './volcAsrProtocol';

export type VolcAsrCredentials = {
  /** New console API key (X-Api-Key). Preferred when set. */
  apiKey?: string;
  /** Legacy console APP ID (X-Api-App-Key). */
  appId?: string;
  /** Legacy console Access Token (X-Api-Access-Key). */
  accessToken?: string;
  resourceId?: string;
};

export type VolcAsrHandlers = {
  onPartial?: (text: string) => void;
  onDefinite?: (text: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

export type VolcAsrSession = {
  sendPcm: (pcm: Uint8Array) => void;
  finish: () => void;
  close: () => void;
};

/**
 * POST creds to the dev proxy, get back a short-lived opaque token AND the full
 * WebSocket URL the caller should connect to. The token — not the original key —
 * is what appears in the WebSocket URL.
 *
 * Three transports:
 *   - **Server-managed** (logged-in + useServerKeys): token via Supabase Edge
 *     Function `ai-volc-asr-token`; URL points at `ai-volc-asr-ws`.
 *   - **Tauri production**: token via the in-process Rust proxy on
 *     `127.0.0.1:<port>`; URL points at `/volc-asr/ws`.
 *   - **Web dev / preview**: token via Vite dev plugin; URL points at
 *     `/api/volc-asr` (same origin).
 */
export async function issueVolcAsrToken(
  creds: VolcAsrCredentials,
  opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<{ token: string; expiresIn: number; wsUrl: string }> {
  const apiKey = (creds.apiKey ?? '').trim();
  const appId = (creds.appId ?? '').trim();
  const accessToken = (creds.accessToken ?? '').trim();

  const f = opts?.fetchImpl ?? fetch;
  let res: Response;
  let wsUrl: string;

  // Prefer local Vite/Tauri ASR proxy when the user has pasted Volc keys — even
  // while LLM calls stay server-managed. Overseas Edge often cannot reach
  // openspeech.bytedance.com.
  const hasLocalVolc =
    !!(creds.apiKey ?? '').trim() ||
    (!!(creds.appId ?? '').trim() && !!(creds.accessToken ?? '').trim());

  if (isServerManaged() && !hasLocalVolc) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error('服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或会话失效)。');
    }
    try {
      res = await f(`${base}/ai-volc-asr-token`, {
        method: 'POST',
        headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({}),
        signal: opts?.signal,
      });
    } catch (e) {
      throw new Error(
        `Volc ASR token issuance failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    wsUrl = `${wsBase}/ai-volc-asr-ws`;
  } else if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const port = await invoke<number | null>('voice_proxy_port');
    if (port == null) {
      throw new Error('Tauri 语音代理未启动 (Rust setup hook 还未绑定端口)。');
    }
    const body: Record<string, string> = {};
    if (apiKey) body.apiKey = apiKey;
    if (appId) body.appId = appId;
    if (accessToken) body.accessToken = accessToken;
    try {
      res = await f(`http://127.0.0.1:${port}/volc-asr/issue-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts?.signal,
      });
    } catch (e) {
      throw new Error(
        `Volc ASR token issuance failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    wsUrl = `ws://127.0.0.1:${port}/volc-asr/ws`;
  } else {
    const body: Record<string, string> = {};
    if (apiKey) body.apiKey = apiKey;
    if (appId) body.appId = appId;
    if (accessToken) body.accessToken = accessToken;
    try {
      res = await f('/api/volc-asr/issue-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts?.signal,
      });
    } catch (e) {
      throw new Error(
        `Volc ASR token issuance failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${proto}//${window.location.host}${VOLC_ASR_PROXY_PATH}`;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: { error?: string; message?: string; hint?: string } | null = null;
    try {
      parsed = JSON.parse(text) as { error?: string; message?: string; hint?: string };
    } catch {
      /* not JSON */
    }
    if (parsed?.error === 'upstream_unreachable') {
      throw new Error(
        '服务器所在区域无法连接火山 ASR（openspeech.bytedance.com）。请在设置中填写本地火山 ASR 密钥，并用 npm run dev 或桌面端走本地代理。',
      );
    }
    const detail = parsed
      ? [parsed.error, parsed.message, parsed.hint].filter(Boolean).join(' — ')
      : text.slice(0, 400);
    throw new Error(`Volc ASR token HTTP ${res.status}: ${detail || 'unknown'}`);
  }
  const json = (await res.json()) as { token?: string; expiresIn?: number; error?: string };
  if (!json.token) {
    throw new Error(`Volc ASR proxy returned no token: ${json.error ?? 'unknown'}`);
  }
  // Default to a 10-min fallback if the proxy forgot to send `expiresIn`. Must match
  // the server's DEFAULT_TOKEN_TTL_MS so callers don't accidentally treat a stale
  // token as fresh.
  const expiresIn = json.expiresIn ?? 10 * 60;

  // Append query params last so the host+path don't double-encode.
  const qs = new URLSearchParams();
  qs.set('token', json.token);
  qs.set('resourceId', (creds.resourceId ?? '').trim() || VOLC_ASR_DEFAULT_RESOURCE_ID);
  qs.set('requestId', crypto.randomUUID());
  const absolute = `${wsUrl}?${qs.toString()}`;
  // Only Edge WS URLs need the publishable `apikey` query; local Vite/Tauri proxies do not.
  const useEdgeWs = isServerManaged() && !hasLocalVolc;
  return {
    token: json.token,
    expiresIn,
    wsUrl: useEdgeWs ? withEdgeFunctionWsParams(absolute) : absolute,
  };
}

export function hasVolcAsrCredentials(creds: VolcAsrCredentials): boolean {
  // Server-managed path always has credentials available server-side.
  if (isServerManaged()) return true;
  if ((creds.apiKey ?? '').trim()) return true;
  return !!(creds.appId ?? '').trim() && !!(creds.accessToken ?? '').trim();
}

/** Map Edge/Volc relay failures to a short user-facing sentence. */
export function formatVolcUpstreamError(raw: string): string {
  const text = raw.trim();
  if (/upstream_http_403/.test(text)) {
    return '火山 ASR 拒绝了服务器连接（HTTP 403）。请核对 developer_secrets.volcAsr 是否为语音识别 Key（不是方舟 LLM Key）；若 Key 无误，则火山可能拦截了海外云 IP，需要国内中继。';
  }
  if (/upstream_http_401/.test(text)) {
    return '火山 ASR 鉴权失败（HTTP 401）。请检查 developer_secrets 里的 API Key / App ID + Access Token。';
  }
  if (/tls_timeout|handshake_timeout|upstream_timeout/.test(text)) {
    return '服务器连不上火山 ASR（超时）。';
  }
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

/** Join utterance texts, skipping exact duplicate segments (nostream can re-emit the same line). */
function joinUtteranceTexts(utterances: VolcAsrUtterance[]): string {
  let out = '';
  for (const u of utterances) {
    const t = (u.text ?? '').trim();
    if (!t) continue;
    if (!out) {
      out = t;
      continue;
    }
    if (t === out || out.endsWith(t)) continue;
    if (t.startsWith(out)) {
      out = t;
      continue;
    }
    out = `${out}${t}`;
  }
  return out;
}

/** Cumulative transcript for result_type=full — prefer server `text`, else utterances. */
function fullTranscriptFromParsed(parsed: {
  text?: string;
  utterances: VolcAsrUtterance[];
}): string {
  const fromText = (parsed.text ?? '').trim();
  if (fromText) return fromText;
  return joinUtteranceTexts(parsed.utterances);
}

export type OpenVolcAsrSessionOptions = {
  /**
   * Pre-issued token from `issueVolcAsrToken`. Skips the POST; useful for tests and
   * for callers that want to refresh on a known schedule.
   */
  token?: string;
  /** Test injection: replace the global `fetch`. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /**
   * JSON string for `request.corpus.context`: hotwords and/or dialog_ctx from
   * the current Ask thread (汤面, persona names, recent replies).
   */
  corpusContext?: string;
};

/**
 * Open a streaming ASR session via same-origin Vite proxy. Credentials are exchanged for
 * a short-lived opaque token so they never appear in the WebSocket URL or browser history.
 */
export async function openVolcAsrSession(
  creds: VolcAsrCredentials,
  handlers: VolcAsrHandlers,
  opts: OpenVolcAsrSessionOptions = {},
): Promise<VolcAsrSession> {
  if (!hasVolcAsrCredentials(creds)) {
    throw new Error('Missing Volc ASR credentials');
  }

  // issueVolcAsrToken returns the fully-resolved wsUrl (Edge Function /
  // localhost Rust proxy / Vite dev plugin). The URL already includes
  // token, resourceId, requestId query params.
  const issued = opts.token
    ? null
    : await issueVolcAsrToken(creds, { signal: opts.signal, fetchImpl: opts.fetchImpl });

  let wsUrl: string;
  if (opts.token) {
    // Caller pre-issued a token; build the URL ourselves. Without knowing
    // the runtime here, use same-origin — only the Vite dev path uses this
    // branch (tests + legacy callers).
    const qs = new URLSearchParams();
    qs.set('token', opts.token);
    qs.set(
      'resourceId',
      (creds.resourceId ?? '').trim() || VOLC_ASR_DEFAULT_RESOURCE_ID,
    );
    qs.set('requestId', crypto.randomUUID());
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${proto}//${window.location.host}${VOLC_ASR_PROXY_PATH}?${qs.toString()}`;
  } else if (issued) {
    wsUrl = issued.wsUrl;
  } else {
    throw new Error('Volc ASR: failed to resolve WS URL');
  }

  console.log('[Spoor ASR] token issued, opening WS', {
    hasApiKey: !!(creds.apiKey ?? '').trim(),
    hasAppId: !!(creds.appId ?? '').trim(),
    resourceId: (creds.resourceId ?? '').trim() || VOLC_ASR_DEFAULT_RESOURCE_ID,
  });

  let closed = false;
  /** Only true after the server acknowledges the full client request (or ready timeout). */
  let ready = false;
  const MAX_PENDING_BYTES = 256 * 1024;
  let pendingBytes = 0;
  const pending: Uint8Array[] = [];
  /** Serialize gzip + send so packet order matches wire order. */
  let writeChain: Promise<void> = Promise.resolve();
  let readyTimer: ReturnType<typeof setTimeout> | null = null;

  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  const enqueueWrite = (task: () => Promise<void>) => {
    writeChain = writeChain
      .then(task)
      .catch((e) => {
        if (closed) return;
        handlers.onError?.(e instanceof Error ? e.message : String(e));
      });
  };

  const flushPending = () => {
    while (pending.length > 0 && ready && !closed) {
      const chunk = pending.shift()!;
      pendingBytes -= chunk.length;
      enqueueWrite(async () => {
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        const frame = await encodeAudioOnlyRequest(chunk);
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        ws.send(frame);
      });
    }
  };

  const markReadyAndFlush = () => {
    if (ready || closed) return;
    ready = true;
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    flushPending();
  };

  let sawOpen = false;
  let gotAck = false;
  ws.onopen = () => {
    sawOpen = true;
    console.log('[Spoor ASR] ws.onopen');
    enqueueWrite(async () => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      const corpusContext = (opts.corpusContext ?? '').trim();
      const fullReq = await encodeFullClientRequest({
        user: { uid: 'spoor-voice' },
        audio: {
          format: 'pcm',
          codec: 'raw',
          rate: 16000,
          bits: 16,
          channel: 1,
        },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
          show_utterances: true,
          result_type: 'full',
          // Stream partials while speaking so the first words appear immediately.
          // `true` waits for a full utterance (plus end_window) before any text.
          enable_nonstream: false,
          // Silence window before definite. 800ms ends mid-thought on any brief pause.
          end_window_size: VOLC_ASR_END_WINDOW_MS,
          // Don't wait a full second to confirm the start of speech.
          force_to_speech_time: 200,
          ...(corpusContext ? { corpus: { context: corpusContext } } : {}),
        },
      });
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      ws.send(fullReq);
      console.log('[Spoor ASR] full client request sent', { bytes: fullReq.byteLength });
      // Prefer waiting for the init full-server-response; fall back so a missed ACK
      // cannot leave the mic buffering forever with no UI error.
      readyTimer = setTimeout(() => {
        console.warn('[Spoor ASR] ready timer fired without ACK — flushing anyway');
        markReadyAndFlush();
      }, 800);
    });
  };

  const handleParsed = (parsed: ReturnType<typeof parseServerFrame>) => {
    if (closed) return;
    console.log('[Spoor ASR] parsed frame', { type: parsed.messageType, text: parsed.text, utterances: parsed.utterances, error: parsed.errorMessage });
    if (parsed.errorMessage) {
      handlers.onError?.(parsed.errorMessage);
      return;
    }

    // Any non-error binary frame means the full client request was accepted.
    gotAck = true;
    if (!ready) console.log('[Spoor ASR] first non-error frame → ready');
    markReadyAndFlush();

    // result_type=full: each frame carries the cumulative transcript. Always emit that
    // whole string (replace upstream) — never only the latest fragment, or voice UI will
    // concatenate revised hypotheses and look like an echo.
    const fullText = fullTranscriptFromParsed(parsed);
    if (!fullText) return;

    const hasDefinite = parsed.utterances.some((u) => u.definite && (u.text ?? '').trim());
    if (hasDefinite) {
      console.log('[Spoor ASR] onDefinite', JSON.stringify(fullText));
      handlers.onDefinite?.(fullText);
      return;
    }

    console.log('[Spoor ASR] onPartial', JSON.stringify(fullText));
    handlers.onPartial?.(fullText);
  };

  ws.onmessage = (ev) => {
    console.log('[Spoor ASR] ws.onmessage', { kind: typeof ev.data, bytes: typeof ev.data === 'string' ? ev.data.length : ev.data.byteLength });
    if (typeof ev.data === 'string') {
      console.log('[Spoor ASR] ws.onmessage text', ev.data.slice(0, 500));
      try {
        const j = JSON.parse(ev.data) as { error?: string; edge?: string };
        if (j.edge) {
          console.log('[Spoor ASR] edge event', j);
        }
        if (j.error) {
          if (!closed) handlers.onError?.(formatVolcUpstreamError(j.error));
        }
      } catch {
        if (!closed) handlers.onError?.(ev.data);
      }
      return;
    }
    const buffer = ev.data as ArrayBuffer;
    const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4));
    const compression = head.length >= 3 ? head[2]! & 0x0f : 0;
    if (compression === 0) {
      handleParsed(parseServerFrame(buffer));
    } else {
      void parseServerFrameAsync(buffer).then((parsed) => handleParsed(parsed));
    }
  };

  ws.onerror = () => {
    console.error('[Spoor ASR] ws.onerror', { sawOpen, ready });
    if (closed) return;
    if (!sawOpen) {
      handlers.onError?.(
        '火山 ASR WebSocket 握手失败（服务器无法升级连接，多半是 Edge 访问不了 openspeech.bytedance.com）。请在设置填写本地火山 ASR 密钥，并用 npm run dev / 桌面端。',
      );
    } else {
      handlers.onError?.('Volc ASR WebSocket error');
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  ws.onclose = (ev) => {
    console.log('[Spoor ASR] ws.onclose', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean, ready });
    // Report even on "clean" closes: Edge often tears down after upgrade when
    // upstream Volc is unreachable, which still looks clean to the browser.
    const shouldReport = !closed && sawOpen && !gotAck;
    closed = true;
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (shouldReport) {
      handlers.onError?.(
        '火山 ASR 未收到识别回包就断开了。请把控制台里 [Spoor ASR] edge event / ws.onmessage text 发给开发者。',
      );
    }
    handlers.onClose?.();
  };

  let sendPcmCount = 0;
  return {
    sendPcm(pcm: Uint8Array) {
      if (closed || pcm.length === 0) return;
      sendPcmCount += 1;
      if (sendPcmCount <= 3 || sendPcmCount % 50 === 0) {
        console.log('[Spoor ASR] sendPcm', { n: sendPcmCount, bytes: pcm.length, ready, wsState: ws.readyState, pending: pending.length });
      }
      if (!ready || ws.readyState !== WebSocket.OPEN) {
        pendingBytes += pcm.length;
        pending.push(pcm);
        while (pendingBytes > MAX_PENDING_BYTES && pending.length > 1) {
          const dropped = pending.shift()!;
          pendingBytes -= dropped.length;
        }
        return;
      }
      enqueueWrite(async () => {
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        const frame = await encodeAudioOnlyRequest(pcm);
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        ws.send(frame);
      });
    },
    finish() {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      enqueueWrite(async () => {
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        const frame = await encodeAudioOnlyRequest(new Uint8Array(0), 0, true);
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        ws.send(frame);
      });
    },
    close() {
      closed = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}
