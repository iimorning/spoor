/**
 * Short UI sound effects for canvas gestures.
 *
 * Files live in `public/sfx/`. Buffers are fetched + decoded ahead of time via
 * Web Audio; `playUiSfx` only starts an already-decoded BufferSource so a click
 * never waits on MP3 decode.
 *
 * Playback is best-effort: missing Web Audio / fetch / decode errors never throw.
 *
 * Source (kept as a comment for attribution):
 * - bubblePop: universfield-bubble-pop-06-351337
 * - paperSwish: the1957files-paper-swish-ui-529818
 */

export type UiSfxKind = 'bubblePop' | 'paperSwish';

const SFX_SRC: Record<UiSfxKind, string> = {
  bubblePop: '/sfx/bubble-pop.mp3',
  paperSwish: '/sfx/paper-swish.mp3?v=2',
};

const VOLUME = 0.45;

let sfxCtx: AudioContext | null = null;
const buffers: Partial<Record<UiSfxKind, AudioBuffer>> = {};
const inflight: Partial<Record<UiSfxKind, Promise<AudioBuffer | null>>> = {};

function ensureContext(): AudioContext | null {
  if (sfxCtx && sfxCtx.state !== 'closed') return sfxCtx;
  try {
    sfxCtx = new AudioContext();
    void sfxCtx.resume().catch(() => {
      /* first user gesture (the + click) usually unblocks this */
    });
  } catch {
    sfxCtx = null;
  }
  return sfxCtx;
}

async function loadBuffer(kind: UiSfxKind): Promise<AudioBuffer | null> {
  const cached = buffers[kind];
  if (cached) return cached;
  if (inflight[kind]) return inflight[kind]!;

  const ctx = ensureContext();
  if (!ctx) return null;

  const promise = (async (): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(SFX_SRC[kind]);
      if (!res.ok) return null;
      const raw = await res.arrayBuffer();
      // slice: decodeAudioData may detach the input ArrayBuffer.
      const decoded = await ctx.decodeAudioData(raw.slice(0));
      buffers[kind] = decoded;
      return decoded;
    } catch {
      return null;
    } finally {
      delete inflight[kind];
    }
  })();
  inflight[kind] = promise;
  return promise;
}

function startBuffer(ctx: AudioContext, buffer: AudioBuffer): void {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = VOLUME;
  source.connect(gain).connect(ctx.destination);
  source.start();
}

/** Fetch + decode so the first click does not pay decode cost. */
export function preloadUiSfx(): void {
  void loadBuffer('bubblePop');
  void loadBuffer('paperSwish');
}

export function playUiSfx(kind: UiSfxKind): void {
  const ctx = ensureContext();
  if (!ctx) return;
  void ctx.resume().catch(() => {
    /* ignore */
  });

  const ready = buffers[kind];
  if (ready) {
    try {
      startBuffer(ctx, ready);
    } catch {
      /* ignore */
    }
    return;
  }

  // Decode off the click frame. If preload has not finished, play when ready
  // rather than blocking React work behind MP3 decode.
  void loadBuffer(kind).then((decoded) => {
    if (!decoded) return;
    const live = ensureContext();
    if (!live) return;
    try {
      startBuffer(live, decoded);
    } catch {
      /* ignore */
    }
  });
}
