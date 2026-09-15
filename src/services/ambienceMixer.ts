import { getAmbienceScene, type AmbienceSceneId } from '../data/ambienceCatalog';

type Listener = () => void;

/** Cached original Freesound blob: URLs (unamplified). */
const bufferedObjectUrls = new Map<string, string>();
/** Cached amplified WAV blob: URLs keyed by `${remoteUrl}|${gain}`. */
const amplifiedObjectUrls = new Map<string, string>();

function prefersFullBuffer(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'cdn.freesound.org' || host.endsWith('.freesound.org');
  } catch {
    return false;
  }
}

function sliderToElementVolume(master: number): number {
  return Math.sqrt(clamp01(master));
}

function getAudioContextConstructor(): (typeof AudioContext) | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const webkit = (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return webkit ?? null;
}

/** Encode an AudioBuffer to a 16-bit PCM WAV Blob (for HTMLAudio playback). */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c]![i]!));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function amplifyAudioBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  gain: number,
): AudioBuffer {
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const input = source.getChannelData(c);
    const output = out.getChannelData(c);
    for (let i = 0; i < input.length; i++) {
      output[i] = Math.max(-1, Math.min(1, input[i]! * gain));
    }
  }
  return out;
}

/**
 * Ambient player: Archive streams via HTMLAudio; Freesound tracks are fully
 * fetched first. Quiet tracks with playbackGain are decoded, amplified into a
 * WAV blob, then played with plain HTMLAudio (no MediaElementSource — that
 * path caused intermittent silence).
 */
export class AmbienceMixer {
  readonly nodeId: string;
  private trackId: AmbienceSceneId | string = 'midnight-rain';
  private master = 1;
  private muted = false;
  private playing = false;
  private loading = false;
  private error: string | null = null;
  private startedAtMs: number | null = null;
  private elapsedOffsetSec = 0;
  private listeners = new Set<Listener>();
  private audio: HTMLAudioElement | null = null;
  private decodeCtx: AudioContext | null = null;
  private activeUrl: string | null = null;
  private triedAlt = false;
  private playGeneration = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private fetchAbort: AbortController | null = null;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  get isPlaying() {
    return this.playing;
  }

  get isLoading() {
    return this.loading;
  }

  get lastError() {
    return this.error;
  }

  getTrackId() {
    return this.trackId;
  }

  getMaster() {
    return this.master;
  }

  isMuted() {
    return this.muted;
  }

  getElapsedSec() {
    if (!this.playing || this.startedAtMs == null) return this.elapsedOffsetSec;
    return this.elapsedOffsetSec + (Date.now() - this.startedAtMs) / 1000;
  }

  applyState(opts: { trackId: string; master: number; muted: boolean }) {
    const trackChanged = opts.trackId !== this.trackId;
    this.trackId = opts.trackId;
    this.master = clamp01(opts.master);
    this.muted = opts.muted;
    this.applyGain();
    if (trackChanged && this.playing) void this.restartStream();
    this.emit();
  }

  setTrack(trackId: string) {
    if (trackId === this.trackId) return;
    this.trackId = trackId;
    if (this.playing) void this.restartStream();
    this.emit();
  }

  setMaster(master: number) {
    this.master = clamp01(master);
    this.applyGain();
    this.emit();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyGain();
    this.emit();
  }

  async play(): Promise<void> {
    stopOtherMixers(this.nodeId);
    this.playing = true;
    this.error = null;
    activeMixerId = this.nodeId;
    if (this.startedAtMs == null) this.startedAtMs = Date.now();
    this.ensureTicker();
    this.emit();
    await this.restartStream();
  }

  stop() {
    this.playing = false;
    this.loading = false;
    this.playGeneration += 1;
    this.fetchAbort?.abort();
    this.fetchAbort = null;
    if (activeMixerId === this.nodeId) activeMixerId = null;
    if (this.startedAtMs != null) {
      this.elapsedOffsetSec += (Date.now() - this.startedAtMs) / 1000;
      this.startedAtMs = null;
    }
    this.teardownAudio();
    this.clearTicker();
    this.emit();
  }

  skip(seconds: number) {
    const audio = this.audio;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      const next = Math.min(Math.max(0, audio.currentTime + seconds), Math.max(0, audio.duration - 0.25));
      try {
        audio.currentTime = next;
      } catch {
        /* ignore */
      }
    }
    if (!this.playing) {
      this.elapsedOffsetSec = Math.max(0, this.elapsedOffsetSec + seconds);
    } else {
      this.elapsedOffsetSec = Math.max(0, this.getElapsedSec() + seconds);
      this.startedAtMs = Date.now();
    }
    this.emit();
  }

  dispose() {
    this.stop();
    this.listeners.clear();
    mixers.delete(this.nodeId);
  }

  private ensureTicker() {
    if (this.tickTimer != null) return;
    this.tickTimer = setInterval(() => {
      if (this.playing) this.emit();
    }, 500);
  }

  private clearTicker() {
    if (this.tickTimer != null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private applyGain() {
    if (!this.audio) return;
    this.audio.volume = this.muted ? 0 : sliderToElementVolume(this.master);
    this.audio.muted = this.muted;
  }

  private teardownAudio() {
    const audio = this.audio;
    this.audio = null;
    this.activeUrl = null;
    if (!audio) return;
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
    audio.removeAttribute('src');
    try {
      audio.load();
    } catch {
      /* ignore */
    }
  }

  private async restartStream(): Promise<void> {
    const generation = ++this.playGeneration;
    this.fetchAbort?.abort();
    this.fetchAbort = null;
    this.teardownAudio();
    this.triedAlt = false;
    if (!this.playing) return;
    const scene = getAmbienceScene(this.trackId);
    await this.startUrl(scene.streamUrl, scene.streamUrlAlt, generation);
  }

  private async fetchBlobUrl(url: string, generation: number): Promise<string> {
    const cached = bufferedObjectUrls.get(url);
    if (cached) return cached;

    const abort = new AbortController();
    this.fetchAbort = abort;
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: abort.signal });
    if (!res.ok) throw new Error(`fetch-${res.status}`);
    const blob = await res.blob();
    if (generation !== this.playGeneration || !this.playing) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const objectUrl = URL.createObjectURL(blob);
    bufferedObjectUrls.set(url, objectUrl);
    return objectUrl;
  }

  private async resolvePlayableSrc(
    url: string,
    generation: number,
    playbackGain: number,
  ): Promise<string> {
    if (!prefersFullBuffer(url)) return url;

    // Without amplify, stream the CDN URL directly — full blob download of 10–16MB
    // previews made cafe/fire feel permanently silent on slow networks.
    if (!(playbackGain > 1)) return url;

    const originalBlobUrl = await this.fetchBlobUrl(url, generation);

    const ampKey = `${url}|${playbackGain}`;
    const ampCached = amplifiedObjectUrls.get(ampKey);
    if (ampCached) return ampCached;

    const AC = getAudioContextConstructor();
    if (!AC) return originalBlobUrl;

    try {
      if (!this.decodeCtx || this.decodeCtx.state === 'closed') {
        this.decodeCtx = new AC();
      }
      if (this.decodeCtx.state === 'suspended') {
        await this.decodeCtx.resume();
      }

      const abort = new AbortController();
      this.fetchAbort = abort;
      const res = await fetch(originalBlobUrl, { signal: abort.signal });
      const raw = await res.arrayBuffer();
      if (generation !== this.playGeneration || !this.playing) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const decoded = await this.decodeCtx.decodeAudioData(raw.slice(0));
      const amplified = amplifyAudioBuffer(this.decodeCtx, decoded, playbackGain);
      const wavBlob = audioBufferToWavBlob(amplified);
      if (generation !== this.playGeneration || !this.playing) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const amplifiedUrl = URL.createObjectURL(wavBlob);
      amplifiedObjectUrls.set(ampKey, amplifiedUrl);
      return amplifiedUrl;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      // Amplify failed — still play the original (quiet but audible).
      return originalBlobUrl;
    }
  }

  private async startUrl(
    url: string,
    alt: string | undefined,
    generation: number,
  ): Promise<void> {
    if (generation !== this.playGeneration || !this.playing) return;
    if (typeof Audio === 'undefined') {
      this.error = 'audio-unavailable';
      this.playing = false;
      this.loading = false;
      this.emit();
      return;
    }

    this.loading = true;
    this.error = null;
    this.activeUrl = url;
    this.emit();

    const scene = getAmbienceScene(this.trackId);
    const playbackGain = scene.playbackGain ?? 1;

    let playableSrc: string;
    try {
      playableSrc = await this.resolvePlayableSrc(url, generation, playbackGain);
    } catch (err) {
      if (generation !== this.playGeneration) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      if (alt && !this.triedAlt) {
        this.triedAlt = true;
        this.teardownAudio();
        await this.startUrl(alt, undefined, generation);
        return;
      }
      this.error = 'stream-failed';
      this.loading = false;
      this.playing = false;
      if (activeMixerId === this.nodeId) activeMixerId = null;
      this.teardownAudio();
      this.clearTicker();
      this.emit();
      return;
    }

    if (generation !== this.playGeneration || !this.playing) return;

    const audio = new Audio();
    audio.preload = 'auto';
    audio.loop = true;
    this.audio = audio;
    this.applyGain();

    let settled = false;
    const fail = () => {
      if (settled || generation !== this.playGeneration) return;
      settled = true;
      if (alt && !this.triedAlt) {
        this.triedAlt = true;
        this.teardownAudio();
        void this.startUrl(alt, undefined, generation);
        return;
      }
      this.error = 'stream-failed';
      this.loading = false;
      this.playing = false;
      if (activeMixerId === this.nodeId) activeMixerId = null;
      this.teardownAudio();
      this.clearTicker();
      this.emit();
    };

    audio.addEventListener('error', fail);
    audio.addEventListener(
      'playing',
      () => {
        if (generation !== this.playGeneration) return;
        settled = true;
        this.loading = false;
        this.error = null;
        this.emit();
      },
      { once: true },
    );

    audio.src = playableSrc;

    try {
      await audio.play();
      if (generation !== this.playGeneration) return;
      this.loading = false;
      this.emit();
    } catch (err) {
      if (generation !== this.playGeneration) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      fail();
    }
  }
}

const mixers = new Map<string, AmbienceMixer>();
let activeMixerId: string | null = null;

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function stopOtherMixers(exceptId: string) {
  for (const [id, mixer] of mixers) {
    if (id !== exceptId && mixer.isPlaying) mixer.stop();
  }
}

export function getAmbienceMixer(nodeId: string): AmbienceMixer {
  let mixer = mixers.get(nodeId);
  if (!mixer) {
    mixer = new AmbienceMixer(nodeId);
    mixers.set(nodeId, mixer);
  }
  return mixer;
}

export function disposeAmbienceMixer(nodeId: string) {
  mixers.get(nodeId)?.dispose();
}

export function getActiveAmbienceMixerId() {
  return activeMixerId;
}

export function clearAmbienceBufferCacheForTests() {
  for (const objectUrl of bufferedObjectUrls.values()) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  }
  bufferedObjectUrls.clear();
  for (const objectUrl of amplifiedObjectUrls.values()) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  }
  amplifiedObjectUrls.clear();
}
