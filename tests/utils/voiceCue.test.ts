import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * jsdom does not provide Web Audio, so stub AudioContext with a recording fake.
 * Tests reset modules between cases so the singleton in voiceCue.ts starts fresh.
 */

type FakeBuffer = {
  length: number;
  sampleRate: number;
  duration: number;
  numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array;
  copyFromChannel: (...args: unknown[]) => void;
  copyToChannel: (...args: unknown[]) => void;
};

class FakeBufferSourceNode {
  buffer: FakeBuffer | null = null;
  started = false;
  connect = vi.fn(() => this);
  start = vi.fn(() => {
    this.started = true;
  });
}

class FakeGainNode {
  gain = { value: 1 };
  connect = vi.fn(() => this);
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static id = 0;
  id: number;
  state: 'running' | 'suspended' | 'closed' = 'running';
  sampleRate = 48000;
  destination = {};
  currentTime = 0;
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number): FakeBuffer => {
    // Stable backing storage so voiceCue's writes are observable via getChannelData.
    const data = new Float32Array(length);
    return {
      length,
      sampleRate,
      duration: length / sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => {
        if (channel === 0) return data;
        return new Float32Array(length);
      },
      copyFromChannel: () => undefined,
      copyToChannel: () => undefined,
    };
  });
  createBufferSource = vi.fn(() => new FakeBufferSourceNode());
  createGain = vi.fn(() => new FakeGainNode());
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  constructor() {
    this.id = ++FakeAudioContext.id;
    FakeAudioContext.instances.push(this);
  }
}

let playVoiceCue: typeof import('../../src/utils/voiceCue').playVoiceCue;

beforeEach(async () => {
  vi.resetModules();
  FakeAudioContext.instances.length = 0;
  FakeAudioContext.id = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const mod = await import('../../src/utils/voiceCue');
  playVoiceCue = mod.playVoiceCue;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playVoiceCue', () => {
  it('creates a single AudioContext that is reused across calls', () => {
    playVoiceCue('on');
    playVoiceCue('off');
    playVoiceCue('on');
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('caches one AudioBuffer per kind', () => {
    playVoiceCue('on');
    playVoiceCue('on');
    playVoiceCue('off');
    playVoiceCue('off');
    const ctx = FakeAudioContext.instances[0];
    // First call to each kind renders, second is a cache hit.
    expect(ctx.createBuffer).toHaveBeenCalledTimes(2);
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(4);
  });

  it('schedules each cue via a fresh BufferSourceNode connected through a GainNode', () => {
    playVoiceCue('on');
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(ctx.createGain).toHaveBeenCalledTimes(1);
    const source = ctx.createBufferSource.mock.results[0].value as FakeBufferSourceNode;
    expect(source.started).toBe(true);
    expect(source.connect).toHaveBeenCalled();
  });

  it('rebuilds the AudioContext once it has been closed', async () => {
    playVoiceCue('on');
    expect(FakeAudioContext.instances).toHaveLength(1);
    const firstCtx = FakeAudioContext.instances[0];
    await firstCtx.close();
    expect(firstCtx.state).toBe('closed');
    playVoiceCue('off');
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioContext.instances[1]).not.toBe(firstCtx);
  });

  it('renders ascending vs descending waveforms distinguishable by dominant frequency', () => {
    // Render both cues first; voiceCue will populate its cache on first call per kind.
    playVoiceCue('on');
    playVoiceCue('off');

    // Reach into the existing createBuffer mock results on the live AudioContext
    // to retrieve the buffers voiceCue actually rendered. There will be exactly two
    // (one for each kind).
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createBuffer.mock.results).toHaveLength(2);
    const onBuf = ctx.createBuffer.mock.results[0].value as FakeBuffer;
    const offBuf = ctx.createBuffer.mock.results[1].value as FakeBuffer;
    const on = onBuf.getChannelData(0);
    const off = offBuf.getChannelData(0);
    expect(on.length).toBeGreaterThan(0);
    expect(off.length).toBeGreaterThan(0);

    // Count zero crossings — a higher pitch produces more crossings per sample.
    // 'on' = C5(523Hz)→E5(659Hz): avg ~591Hz; 'off' = E5→C5: avg ~591Hz.
    // Same average but different distribution across the buffer:
    // 'on' has the LOWER frequency in the first half; 'off' has the HIGHER frequency.
    const crossings = (data: Float32Array) => {
      let n = 0;
      for (let i = 1; i < data.length; i++) {
        if ((data[i - 1] < 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] < 0)) n++;
      }
      return n;
    };
    const halfCrossings = (data: Float32Array) => {
      const half = Math.floor(data.length / 2);
      const first = crossings(data.subarray(0, half));
      const second = crossings(data.subarray(half));
      return { first, second };
    };
    const onHalves = halfCrossings(on);
    const offHalves = halfCrossings(off);
    // 'on' starts low → ends high: first-half crossings < second-half crossings.
    expect(onHalves.first).toBeLessThan(onHalves.second);
    // 'off' starts high → ends low: first-half crossings > second-half crossings.
    expect(offHalves.first).toBeGreaterThan(offHalves.second);
  });

  it('swallows AudioContext construction failures', () => {
    // Replace the stub with one that throws on construction.
    class ThrowingAudioContext {
      constructor() {
        throw new Error('audio not available');
      }
    }
    vi.stubGlobal('AudioContext', ThrowingAudioContext);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Should not throw out to the caller.
    expect(() => playVoiceCue('on')).not.toThrow();
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('swallows playback failures (e.g. start throws)', () => {
    const ctx = FakeAudioContext.instances[0] ?? null;
    playVoiceCue('on'); // initial call to populate the ctx cache
    // Re-trigger by making createBufferSource throw the second time.
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const realCtx = FakeAudioContext.instances[0];
    realCtx.createBufferSource = vi.fn(() => {
      throw new Error('start blocked');
    });
    expect(() => playVoiceCue('off')).not.toThrow();
    expect(consoleWarn).toHaveBeenCalled();
  });
});