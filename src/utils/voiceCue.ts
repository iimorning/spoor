/**
 * Short audible cues that mark the start / end of voice writing mode.
 *
 * Two short sine tones played back-to-back give the user a clear, non-verbal signal
 * that mic capture actually began (or ended), without competing with TTS playback.
 *
 * The cue `AudioContext` is independent of the mic-capture context (16 kHz, owned by
 * `micCapture.ts`) and the TTS context (32 kHz, owned by `minimaxTtsStream.ts`) — those
 * are torn down at the end of each capture / playback cycle, while the cue context
 * lives for the lifetime of the page so back-to-back cues don't re-trigger an
 * audible click from `close()`/`new`.
 */

export type VoiceCueKind = 'on' | 'off';

/** Each note in a cue. */
const NOTE_MS = 80;
/** Linear ramp at the head of each note — kills the start click. */
const ATTACK_MS = 5;
/** Linear ramp at the tail of each note — kills the end click without a long fade. */
const RELEASE_MS = 8;
/** Peak gain (0..1) of each note. ~ -15 dB; audible but never clipping. */
const PEAK_GAIN = 0.18;

/** Ascending cue: mic + ASR just went live. */
const ON_FREQS: readonly [number, number] = [523.25, 659.25]; // C5 → E5
/** Descending cue: voice mode fully exited. */
const OFF_FREQS: readonly [number, number] = [659.25, 523.25]; // E5 → C5

let cueCtx: AudioContext | null = null;
/** Pre-rendered buffers keyed by kind so we don't re-synthesize per cue. */
const cueBuffers: Partial<Record<VoiceCueKind, AudioBuffer>> = {};

function ensureContext(): AudioContext | null {
  if (cueCtx && cueCtx.state !== 'closed') return cueCtx;
  try {
    // Browsers may construct the context in 'suspended' state until a user gesture
    // resumes it; `resume()` is fire-and-forget so the cue still queues.
    cueCtx = new AudioContext();
    void cueCtx.resume().catch(() => {
      /* ignore — first user gesture (the mic click) usually unblocks this */
    });
  } catch (e) {
    console.warn('[Spoor Voice] cue AudioContext failed', e);
    cueCtx = null;
  }
  return cueCtx;
}

/**
 * Render the two-tone buffer for `kind` if we haven't already, then play it.
 * Returns silently if Web Audio is unavailable (e.g. jsdom, locked-down browsers);
 * cues are a UX nicety, never a hard dependency.
 */
export function playVoiceCue(kind: VoiceCueKind): void {
  const ctx = ensureContext();
  if (!ctx) return;

  try {
    const buffer = cueBuffers[kind] ?? renderCueBuffer(ctx, kind);
    cueBuffers[kind] = buffer;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = PEAK_GAIN;
    source.connect(gain).connect(ctx.destination);
    source.start();
  } catch (e) {
    console.warn('[Spoor Voice] cue playback failed', e);
  }
}

function renderCueBuffer(ctx: AudioContext, kind: VoiceCueKind): AudioBuffer {
  const freqs = kind === 'on' ? ON_FREQS : OFF_FREQS;
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.round((NOTE_MS * freqs.length) * (sampleRate / 1000));
  const noteSamples = Math.round(NOTE_MS * (sampleRate / 1000));
  const attackSamples = Math.round(ATTACK_MS * (sampleRate / 1000));
  const releaseSamples = Math.round(RELEASE_MS * (sampleRate / 1000));

  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  for (let n = 0; n < freqs.length; n++) {
    const offset = n * noteSamples;
    const freq = freqs[n];
    const omega = (2 * Math.PI * freq) / sampleRate;
    for (let i = 0; i < noteSamples; i++) {
      const t = i;
      // Linear envelope: ramp up over `attackSamples`, hold, ramp down over `releaseSamples`.
      let env = 1;
      if (t < attackSamples) {
        env = t / attackSamples;
      } else if (t > noteSamples - releaseSamples) {
        env = Math.max(0, (noteSamples - t) / releaseSamples);
      }
      data[offset + i] = Math.sin(omega * i) * env;
    }
  }
  return buffer;
}