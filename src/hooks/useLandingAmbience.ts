import { useEffect, useRef } from 'react';
import {
  AMBIANCE_AUDIO,
  AMBIANCE_CROSSFADE_MS,
  AMBIANCE_VOLUME,
  isActiveAmbiance,
  type LandingAmbiance,
} from '../utils/landingAmbience';

type AmbianceTheme = Exclude<LandingAmbiance, 'default'>;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function fadeMs(): number {
  return prefersReducedMotion() ? 120 : AMBIANCE_CROSSFADE_MS;
}

function makeAudio(): HTMLAudioElement {
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  return audio;
}

/**
 * Loop theme ambience while an active ambiance is set and not muted.
 * Switches crossfade between two Audio buffers so theme changes feel soft.
 * Audio unlocks on the first user gesture (note editing counts).
 */
export function useLandingAmbience(options: {
  ambiance: LandingAmbiance;
  muted: boolean;
  /** Bump after a pointer/keyboard gesture so play() is allowed. */
  audioUnlocked: boolean;
}) {
  const { ambiance, muted, audioUnlocked } = options;

  const aRef = useRef<HTMLAudioElement | null>(null);
  const bRef = useRef<HTMLAudioElement | null>(null);
  /** Which buffer is currently audible (or last audible). */
  const activeSlotRef = useRef<'a' | 'b'>('a');
  const themeRef = useRef<AmbianceTheme | null>(null);
  const fadeGenRef = useRef(0);
  const rafIdsRef = useRef<Set<number>>(new Set());

  const cancelFades = () => {
    fadeGenRef.current += 1;
    for (const id of rafIdsRef.current) cancelAnimationFrame(id);
    rafIdsRef.current.clear();
  };

  const ensureBuffers = () => {
    if (!aRef.current) aRef.current = makeAudio();
    if (!bRef.current) bRef.current = makeAudio();
    return { a: aRef.current, b: bRef.current };
  };

  const slotAudio = (slot: 'a' | 'b') =>
    slot === 'a' ? aRef.current! : bRef.current!;

  const animateVolume = (
    audio: HTMLAudioElement,
    to: number,
    ms: number,
    gen: number,
  ): Promise<void> =>
    new Promise((resolve) => {
      const from = audio.volume;
      if (ms <= 0 || Math.abs(from - to) < 0.008) {
        audio.volume = to;
        resolve();
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        if (gen !== fadeGenRef.current) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / ms);
        audio.volume = from + (to - from) * easeInOut(t);
        if (t < 1) {
          const id = requestAnimationFrame(tick);
          rafIdsRef.current.add(id);
        } else {
          audio.volume = to;
          resolve();
        }
      };
      const id = requestAnimationFrame(tick);
      rafIdsRef.current.add(id);
    });

  // Preload all beds once so the first switch isn't a cold start.
  useEffect(() => {
    const { a, b } = ensureBuffers();
    const themes = Object.keys(AMBIANCE_AUDIO) as AmbianceTheme[];
    for (const theme of themes) {
      const probe = new Audio();
      probe.preload = 'auto';
      probe.src = AMBIANCE_AUDIO[theme];
      probe.load();
    }
    return () => {
      cancelFades();
      for (const audio of [a, b]) {
        audio.pause();
        audio.src = '';
      }
      aRef.current = null;
      bRef.current = null;
      themeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);

  useEffect(() => {
    ensureBuffers();
    const ms = fadeMs();
    const gen = ++fadeGenRef.current;

    const run = async () => {
      const activeSlot = activeSlotRef.current;
      const current = slotAudio(activeSlot);
      const otherSlot = activeSlot === 'a' ? 'b' : 'a';
      const next = slotAudio(otherSlot);

      // Muted, or audio still locked: soft silence.
      if (muted || !audioUnlocked) {
        await animateVolume(current, 0, ms, gen);
        if (gen !== fadeGenRef.current) return;
        current.pause();
        next.pause();
        next.volume = 0;
        return;
      }

      // Back to default: fade out whatever is playing.
      if (!isActiveAmbiance(ambiance)) {
        await animateVolume(current, 0, ms, gen);
        if (gen !== fadeGenRef.current) return;
        current.pause();
        next.pause();
        next.volume = 0;
        themeRef.current = null;
        return;
      }

      const targetVol = AMBIANCE_VOLUME[ambiance];

      // Same theme already on the audible slot — just restore volume.
      if (themeRef.current === ambiance) {
        if (current.paused) {
          current.volume = 0;
          try {
            await current.play();
          } catch {
            return;
          }
        }
        await animateVolume(current, targetVol, ms, gen);
        return;
      }

      // Crossfade into the idle buffer.
      next.pause();
      next.src = AMBIANCE_AUDIO[ambiance];
      next.load();
      next.volume = 0;
      try {
        await next.play();
      } catch {
        return;
      }
      if (gen !== fadeGenRef.current) return;

      if (!current.paused && current.volume > 0.01) {
        await Promise.all([
          animateVolume(current, 0, ms, gen),
          animateVolume(next, targetVol, ms, gen),
        ]);
      } else {
        current.pause();
        current.volume = 0;
        await animateVolume(next, targetVol, ms, gen);
      }

      if (gen !== fadeGenRef.current) return;
      current.pause();
      current.volume = 0;
      activeSlotRef.current = otherSlot;
      themeRef.current = ambiance;
    };

    void run();

    return () => {
      cancelFades();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buffers are stable refs
  }, [ambiance, muted, audioUnlocked]);
}
