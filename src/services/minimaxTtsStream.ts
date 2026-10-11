import { MINIMAX_DEFAULT_TTS_MODEL } from '../constants/voiceWriting';
import { resolveMinimaxTtsProfile } from '../utils/minimaxTtsVoice';
import { isServerManaged, getFunctionsBase, resolveAccessToken, edgeFunctionHeaders, withEdgeFunctionWsParams } from '../lib/serverConfig';
import { pcm16ToWavBytes } from '../utils/pcmToWav';
import { isTauriRuntime } from '../utils/isTauriRuntime';

const ISSUE_PATH = '/api/minimax-tts/issue-token';
const WS_PATH = '/api/minimax-tts';
const PCM_SAMPLE_RATE = 32_000;

type MinimaxEvent = {
  event?: string;
  data?: { audio?: string | null };
  is_final?: boolean;
  base_resp?: { status_code?: number; status_msg?: string };
  error?: string;
};

export type MinimaxTtsStreamOptions = {
  apiKey: string;
  model?: string;
  voiceId?: string;
  /** App UI language (`en` / `zh`); drives default voice and language_boost. */
  language?: string;
  onSpeakingChange?: (speaking: boolean) => void;
  /** Fires when a sentence's audio actually starts playing; `null` when the queue goes idle. */
  onActiveTextChange?: (text: string | null) => void;
  onError?: (message: string) => void;
  /**
   * 把合成出来的 PCM 也留一份，供 {@link MinimaxTtsStream.takeRecordedWav} 取走做缓存
   * （试听用）。默认关：正常朗读几十秒的音频没必要留在内存里。
   */
  recordAudio?: boolean;
};

export type MinimaxTtsStream = {
  enqueueText: (text: string) => void;
  finish: () => void;
  waitUntilIdle: () => Promise<void>;
  stop: () => void;
  /**
   * 开了 recordAudio 才有：把这次合成拼成 WAV 字节（不包 Blob —— 缓存直接存字节，
   * 存 Blob 再取字节在某些环境里没有 `Blob.arrayBuffer`，会静默存不进去）。
   */
  takeRecordedWavBytes: () => Uint8Array | null;
};

function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/[^0-9a-f]/gi, '');
  const bytes = new Uint8Array(Math.floor(cleaned.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function pcm16leToFloat32(bytes: Uint8Array): Float32Array {
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000;
  return samples;
}

async function issueToken(apiKey: string): Promise<{ token: string; wsUrl: string }> {
  // Logged-in users with useServerKeys hit the Edge Function; everyone else uses
  // the dev Vite plugin (which receives the user-supplied key in the body) or
  // the in-process Tauri Rust proxy when running under Tauri's webview.
  if (isServerManaged()) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error('服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或会话失效)。');
    }
    const res = await fetch(`${base}/ai-minimax-tts-token`, {
      method: 'POST',
      headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !body.token) throw new Error(body.error || `MiniMax TTS token HTTP ${res.status}`);
    const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return {
      token: body.token,
      wsUrl: withEdgeFunctionWsParams(
        `${wsBase}/ai-minimax-tts-ws?token=${encodeURIComponent(body.token)}`,
      ),
    };
  }

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const port = await invoke<number | null>('voice_proxy_port');
    if (port == null) {
      throw new Error('Tauri 语音代理未启动 (Rust setup hook 还未绑定端口)。');
    }
    const res = await fetch(`http://127.0.0.1:${port}/minimax-tts/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !body.token) throw new Error(body.error || `MiniMax TTS token HTTP ${res.status}`);
    return { token: body.token, wsUrl: `ws://127.0.0.1:${port}/minimax-tts/ws?token=${encodeURIComponent(body.token)}` };
  }

  const res = await fetch(ISSUE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error || `MiniMax TTS token HTTP ${res.status}`);
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return { token: body.token, wsUrl: `${protocol}//${window.location.host}${WS_PATH}?token=${encodeURIComponent(body.token)}` };
}

/**
 * MiniMax's official WebSocket protocol emits hex PCM chunks in `task_continued` events.
 * A single AudioContext schedule is used so chunks never create independent HTMLAudioElement
 * playback races or sentence-boundary gaps.
 */
export async function openMinimaxTtsStream(options: MinimaxTtsStreamOptions): Promise<MinimaxTtsStream> {
  const apiKey = options.apiKey.trim();
  // Server-managed users don't need a local apiKey — the Edge Function reads
  // it from developer_secrets. Only non-server callers fail on empty key.
  if (!isServerManaged() && !apiKey) throw new Error('Missing MiniMax API key');
  const { voiceId, languageBoost } = resolveMinimaxTtsProfile({
    customVoiceId: options.voiceId,
    language: options.language,
  });
  const issued = await issueToken(apiKey);
  const ws = new WebSocket(issued.wsUrl);

  let closed = false;
  /** User stop() or a real mid-stream failure. Socket teardown after a finished
   *  task must not set this — synthesis ends before audible playback, and the
   *  playhead still has to walk the remaining buffers. */
  let playbackAborted = false;
  let started = false;
  let finishing = false;
  let finishSent = false;
  let taskInFlight = false;
  let speaking = false;
  let audioContext: AudioContext | null = null;
  let scheduledUntil = 0;
  let activeSources = 0;
  let audioChain: Promise<void> = Promise.resolve();
  const texts: string[] = [];
  /** recordAudio 时攒下的 PCM 分片，最后由 takeRecordedWav 拼成 WAV。 */
  const recordedChunks: Uint8Array[] | null = options.recordAudio ? [] : null;
  const idleWaiters: Array<() => void> = [];
  /** Sentence currently being synthesized (may still be ahead of audible playback). */
  let currentTaskText: string | null = null;
  /** Whether we've already armed the playhead highlight for `currentTaskText`. */
  let taskPlayheadArmed = false;
  const playheadTimers: ReturnType<typeof setTimeout>[] = [];

  let activeText: string | null = null;

  const setSpeaking = (value: boolean) => {
    if (speaking === value) return;
    speaking = value;
    options.onSpeakingChange?.(value);
  };

  const setActiveText = (text: string | null) => {
    if (activeText === text) return;
    activeText = text;
    options.onActiveTextChange?.(text);
  };

  const clearPlayheadTimers = () => {
    while (playheadTimers.length) clearTimeout(playheadTimers.shift()!);
  };

  /** Arm highlight for when this sentence's first audio buffer actually starts. */
  const armPlayheadAt = (text: string, audioTime: number, ctx: AudioContext) => {
    const delayMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
    const timer = setTimeout(() => {
      if (!playbackAborted) setActiveText(text);
    }, delayMs);
    playheadTimers.push(timer);
  };

  const fail = (message: string) => {
    if (closed) return;
    closed = true;
    playbackAborted = true;
    options.onError?.(message);
    clearPlayheadTimers();
    setSpeaking(false);
    setActiveText(null);
    while (idleWaiters.length) idleWaiters.shift()?.();
    try {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    } catch {
      /* ignore */
    }
  };

  const isIdle = () => finishSent && !taskInFlight && texts.length === 0 && activeSources === 0;
  const settleIdle = () => {
    if (!isIdle()) return;
    clearPlayheadTimers();
    setSpeaking(false);
    setActiveText(null);
    while (idleWaiters.length) idleWaiters.shift()?.();
  };

  const send = (payload: object) => {
    if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const sendNext = () => {
    if (!started || taskInFlight || closed) return;
    const text = texts.shift();
    if (text) {
      taskInFlight = true;
      currentTaskText = text;
      taskPlayheadArmed = false;
      send({ event: 'task_continue', text });
      return;
    }
    if (finishing && !finishSent) {
      finishSent = true;
      send({ event: 'task_finish' });
      settleIdle();
    }
  };

  const schedulePcm = (hex: string, announceText: string | null) => {
    // Count before awaiting resume so task_final cannot settle the session prematurely.
    activeSources += 1;
    audioChain = audioChain
      .then(async () => {
        const bytes = hexToBytes(hex);
        if (recordedChunks && bytes.length) recordedChunks.push(bytes);
        if (!bytes.length || playbackAborted) {
          activeSources -= 1;
          settleIdle();
          return;
        }
        audioContext ??= new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
        if (audioContext.state === 'suspended') await audioContext.resume();
        const samples = pcm16leToFloat32(bytes);
        const buffer = audioContext.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
        buffer.copyToChannel(samples, 0);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        const startAt = Math.max(audioContext.currentTime + 0.03, scheduledUntil);
        scheduledUntil = startAt + buffer.duration;
        if (announceText) {
          armPlayheadAt(announceText, startAt, audioContext);
        }
        setSpeaking(true);
        source.onended = () => {
          activeSources -= 1;
          settleIdle();
        };
        source.start(startAt);
      })
      .catch((e) => {
        activeSources -= 1;
        fail(e instanceof Error ? e.message : String(e));
        settleIdle();
      });
  };

  ws.onopen = () => {
    if (closed) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      } catch {
        /* ignore */
      }
      return;
    }
    // Official protocol waits for connected_success before task_start.
  };
  ws.onmessage = (event) => {
    let raw = '';
    if (typeof event.data === 'string') {
      raw = event.data;
    } else if (event.data instanceof ArrayBuffer) {
      raw = new TextDecoder().decode(event.data);
    } else if (ArrayBuffer.isView(event.data)) {
      raw = new TextDecoder().decode(event.data);
    } else {
      raw = String(event.data);
    }
    let payload: MinimaxEvent;
    try {
      payload = JSON.parse(raw) as MinimaxEvent;
    } catch {
      fail('MiniMax TTS returned invalid WebSocket JSON');
      return;
    }
    if ((payload as { edge?: string }).edge) return;
    const code = payload.base_resp?.status_code;
    if ((typeof code === 'number' && code !== 0) || payload.event === 'error') {
      fail(payload.error || payload.base_resp?.status_msg || `MiniMax TTS error ${code ?? 'unknown'}`);
      return;
    }
    if (payload.event === 'connected_success') {
      send({
        event: 'task_start',
        model: options.model?.trim() || MINIMAX_DEFAULT_TTS_MODEL,
        language_boost: languageBoost,
        voice_setting: {
          voice_id: voiceId,
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: PCM_SAMPLE_RATE,
          format: 'pcm',
          channel: 1,
        },
      });
      return;
    }
    if (payload.event === 'task_started') {
      started = true;
      sendNext();
      return;
    }
    if (payload.event === 'task_continued') {
      if (payload.data?.audio) {
        // Highlight follows audible playback, not synthesis start (synth runs ahead).
        const announce = !taskPlayheadArmed ? currentTaskText : null;
        if (announce) taskPlayheadArmed = true;
        schedulePcm(payload.data.audio, announce);
      }
      if (payload.is_final) {
        taskInFlight = false;
        sendNext();
      }
      return;
    }
    if (payload.event === 'task_finished') {
      settleIdle();
    }
  };
  ws.onerror = () => {
    // Chrome reports "Close received after close" when the server tears down a
    // socket we already finished. That is not a playback failure.
    if (closed || finishSent || playbackAborted) return;
    fail('MiniMax TTS WebSocket error');
  };
  ws.onclose = () => {
    if (!closed && !finishSent) fail('MiniMax TTS WebSocket closed unexpectedly');
    // Leave `closed` alone after a successful finish: remaining PCM and
    // playhead timers must keep running until audible playback ends.
    settleIdle();
  };

  return {
    enqueueText(text: string) {
      const value = text.trim();
      if (!value || closed) return;
      texts.push(value);
      sendNext();
    },
    finish() {
      if (closed) return;
      finishing = true;
      sendNext();
    },
    waitUntilIdle() {
      if (isIdle()) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    takeRecordedWavBytes() {
      if (!recordedChunks || recordedChunks.length === 0) return null;
      return pcm16ToWavBytes(recordedChunks, PCM_SAMPLE_RATE);
    },
    stop() {
      if (closed) return;
      closed = true;
      playbackAborted = true;
      texts.length = 0;
      currentTaskText = null;
      taskPlayheadArmed = false;
      clearPlayheadTimers();
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      } catch { /* ignore */ }
      try { void audioContext?.close(); } catch { /* ignore */ }
      activeSources = 0;
      setSpeaking(false);
      setActiveText(null);
      while (idleWaiters.length) idleWaiters.shift()?.();
    },
  };
}
