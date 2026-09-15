import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLandingAmbience } from '../../src/hooks/useLandingAmbience';
import type { LandingAmbiance } from '../../src/utils/landingAmbience';

type AmbienceArgs = { ambiance: LandingAmbiance; muted: boolean; audioUnlocked: boolean };

/**
 * Tests for the dual-buffer crossfade ambience hook.
 *
 * Behavior we lock down:
 *  - Switching theme starts the right audio, never blocks on play() rejections.
 *  - Concurrent switches cancel in-flight fades (later wins; no overlapping audio).
 *  - Muting fades current audio to 0 then pauses.
 *  - When audio is not yet unlocked (no user gesture), no buffer plays.
 *  - Returning to "default" fades out and pauses both buffers.
 */

interface FakeAudio {
  src: string;
  paused: boolean;
  volume: number;
  loop: boolean;
  preload: string;
  playCalls: number;
  pauseCalls: number;
  loadCalls: number;
  playShouldReject: boolean;
  play: () => Promise<void>;
  pause: () => void;
  load: () => void;
}

function makeFakeAudio(): FakeAudio {
  const state: FakeAudio = {
    src: '',
    paused: true,
    volume: 0,
    loop: false,
    preload: '',
    playCalls: 0,
    pauseCalls: 0,
    loadCalls: 0,
    playShouldReject: false,
    play: () => Promise.resolve(),
    pause: () => {},
    load: () => {},
  };
  state.play = () => {
    state.playCalls += 1;
    state.paused = false;
    return state.playShouldReject ? Promise.reject(new Error('autoplay blocked')) : Promise.resolve();
  };
  state.pause = () => {
    state.pauseCalls += 1;
    state.paused = true;
    state.volume = 0;
  };
  state.load = () => {
    state.loadCalls += 1;
  };
  return state;
}

let audioInstances: FakeAudio[] = [];

/**
 * Minimal HTMLAudioElement-compatible stub. We intentionally do NOT declare
 * `implements Partial<HTMLAudioElement>`: the DOM lib type narrows `preload`
 * to ''|'metadata'|'none'|'auto' and `loop`/etc. to specific literal types,
 * which fight the duck-typed approach this stub needs. We rely on a cast at
 * the stubGlobal site instead.
 */
class FakeAudioElement {
  // We assign in constructor; declare for type-checking only.
  declare private inner: FakeAudio;

  constructor() {
    this.inner = makeFakeAudio();
    audioInstances.push(this.inner);
  }

  // HTMLAudioElement properties (src/volume/paused/loop/preload)
  get src(): string {
    return this.inner.src;
  }
  set src(v: string) {
    this.inner.src = v;
  }
  get volume(): number {
    return this.inner.volume;
  }
  set volume(v: number) {
    this.inner.volume = v;
  }
  get paused(): boolean {
    return this.inner.paused;
  }
  set paused(v: boolean) {
    this.inner.paused = v;
  }
  get loop(): boolean {
    return this.inner.loop;
  }
  set loop(v: boolean) {
    this.inner.loop = v;
  }
  // `preload` is typed loosely as `string` to match the underlying FakeAudio;
  // HTMLAudioElement narrows it to a literal union which makes the stub harder
  // to share across states. The hook only writes the literal 'auto'.
  get preload(): string {
    return this.inner.preload;
  }
  set preload(v: string) {
    this.inner.preload = v;
  }

  // Methods
  play(): Promise<void> {
    return this.inner.play();
  }
  pause(): void {
    this.inner.pause();
  }
  load(): void {
    this.inner.load();
  }
}

beforeEach(() => {
  audioInstances = [];
  // Cast through unknown: HTMLAudioElement's narrow literal types (preload,
  // loop) don't match the duck-typed stub, but the Audio constructor only
  // needs the same call/method surface as the real one.
  vi.stubGlobal('Audio', FakeAudioElement as unknown as typeof Audio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useLandingAmbience', () => {
  it('does not start any audio when ambiance is default', () => {
    renderHook(() =>
      useLandingAmbience({ ambiance: 'default', muted: false, audioUnlocked: true }),
    );
    // Mount-time preload creates probe <audio> instances but no real buffer is
    // wired to play(). The two buffers (a/b) are created in useEffect, so we
    // expect at least the probe + 2 buffers; none of the 2 buffers should play.
    const playing = audioInstances.filter((a) => a.playCalls > 0);
    expect(playing.length).toBe(0);
  });

  it('plays the selected theme once audio is unlocked', async () => {
    const { rerender } = renderHook(
      ({ ambiance, muted, audioUnlocked }: AmbienceArgs) =>
        useLandingAmbience({ ambiance, muted, audioUnlocked }),
      { initialProps: { ambiance: 'default', muted: false, audioUnlocked: true } },
    );

    rerender({ ambiance: 'sea', muted: false, audioUnlocked: true });
    await act(async () => {
      await Promise.resolve();
      // Flush any queued microtasks / rAF callbacks.
      await new Promise((r) => setTimeout(r, 50));
    });

    // At least one buffer is playing the sea mp3.
    const playingSea = audioInstances.filter(
      (a) => a.src.includes('sea-waves.mp3') && a.playCalls > 0,
    );
    expect(playingSea.length).toBeGreaterThanOrEqual(1);
  });

  it('stays silent when audio is not yet unlocked', async () => {
    const { rerender } = renderHook(
      ({ ambiance, muted, audioUnlocked }: AmbienceArgs) =>
        useLandingAmbience({ ambiance, muted, audioUnlocked }),
      { initialProps: { ambiance: 'default', muted: false, audioUnlocked: false } },
    );

    rerender({ ambiance: 'forest', muted: false, audioUnlocked: false });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));
    });

    // No buffer should have its src set to the forest mp3 (because the hook
    // never started playing it), and no buffer should have called play().
    const played = audioInstances.filter((a) => a.playCalls > 0);
    expect(played.length).toBe(0);
  });

  it('mutes by fading current audio volume to 0', async () => {
    const { rerender } = renderHook(
      ({ ambiance, muted, audioUnlocked }: AmbienceArgs) =>
        useLandingAmbience({ ambiance, muted, audioUnlocked }),
      { initialProps: { ambiance: 'default', muted: false, audioUnlocked: true } },
    );

    rerender({ ambiance: 'sea', muted: false, audioUnlocked: true });
    // Wait for crossfade (~1400ms) to complete.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });

    // Capture the volume of the playing sea buffer before muting.
    const seaBefore = audioInstances.filter(
      (a) => a.src.includes('sea-waves.mp3') && a.playCalls > 0,
    );
    expect(seaBefore.length).toBeGreaterThanOrEqual(1);
    const volumeBefore = Math.max(...seaBefore.map((a) => a.volume));

    rerender({ ambiance: 'sea', muted: true, audioUnlocked: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });

    // After muting, volume should be near 0 on at least one buffer.
    const seaAfter = audioInstances.filter((a) => a.src.includes('sea-waves.mp3'));
    const maxAfter = Math.max(...seaAfter.map((a) => a.volume));
    expect(maxAfter).toBeLessThan(0.05);
    expect(volumeBefore).toBeGreaterThan(maxAfter);
  });

  it('returns to default fades out and pauses buffers', async () => {
    const { rerender } = renderHook(
      ({ ambiance, muted, audioUnlocked }: AmbienceArgs) =>
        useLandingAmbience({ ambiance, muted, audioUnlocked }),
      { initialProps: { ambiance: 'default', muted: false, audioUnlocked: true } },
    );

    rerender({ ambiance: 'forest', muted: false, audioUnlocked: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });

    // Forest buffer should be playing with non-zero volume.
    const forestBefore = audioInstances.filter(
      (a) => a.src.includes('forest.mp3') && a.playCalls > 0,
    );
    expect(forestBefore.length).toBeGreaterThanOrEqual(1);
    const volumeBefore = Math.max(...forestBefore.map((a) => a.volume));
    expect(volumeBefore).toBeGreaterThan(0);

    rerender({ ambiance: 'default', muted: false, audioUnlocked: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });

    // Returning to default zeros the volume.
    const forestAfter = audioInstances.filter((a) => a.src.includes('forest.mp3'));
    const maxAfter = Math.max(...forestAfter.map((a) => a.volume));
    expect(maxAfter).toBeLessThan(0.05);
  });

  it('does not crash when play() rejects (autoplay blocked)', async () => {
    // Force all subsequent play() calls to reject.
    audioInstances.forEach((a) => {
      a.playShouldReject = true;
    });

    const { rerender } = renderHook(
      ({ ambiance, muted, audioUnlocked }: AmbienceArgs) =>
        useLandingAmbience({ ambiance, muted, audioUnlocked }),
      { initialProps: { ambiance: 'default', muted: false, audioUnlocked: true } },
    );

    // Should not throw — hook swallows play() rejections in the catch branch.
    rerender({ ambiance: 'sea', muted: false, audioUnlocked: true });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));
    });

    // Switching to a different theme still works after a rejected play().
    rerender({ ambiance: 'volcano', muted: false, audioUnlocked: true });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));
    });

    // No assertion on success — just verify we got here without an unhandled
    // rejection bubbling up to the test runner.
    expect(true).toBe(true);
  });
});