import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

type FakeBuffer = {
  length: number;
  sampleRate: number;
  getChannelData: (channel: number) => Float32Array;
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
  state: 'running' | 'suspended' | 'closed' = 'running';
  sampleRate = 48000;
  destination = {};
  decodeAudioData = vi.fn(async (_raw: ArrayBuffer): Promise<FakeBuffer> =>
    this.createBuffer(1, 8, this.sampleRate),
  );
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number): FakeBuffer => {
    const data = new Float32Array(length);
    return {
      length,
      sampleRate,
      getChannelData: (channel: number) => (channel === 0 ? data : new Float32Array(length)),
    };
  });
  createBufferSource = vi.fn(() => new FakeBufferSourceNode());
  createGain = vi.fn(() => new FakeGainNode());
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

let playUiSfx: typeof import('../../src/utils/uiSfx').playUiSfx;
let preloadUiSfx: typeof import('../../src/utils/uiSfx').preloadUiSfx;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(32),
    url,
  }));
  vi.stubGlobal('fetch', fetchMock);
  const mod = await import('../../src/utils/uiSfx');
  playUiSfx = mod.playUiSfx;
  preloadUiSfx = mod.preloadUiSfx;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playUiSfx', () => {
  it('preload decodes the clip; play starts a BufferSource without fetching again', async () => {
    preloadUiSfx();
    await vi.waitFor(() => {
      expect(FakeAudioContext.instances[0]?.decodeAudioData).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    playUiSfx('bubblePop');
    playUiSfx('bubblePop');

    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
    const source = ctx.createBufferSource.mock.results[0].value as FakeBufferSourceNode;
    expect(source.started).toBe(true);
  });

  it('play before preload does not block; starts once decode finishes', async () => {
    playUiSfx('bubblePop');
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createBufferSource).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith('/sfx/bubble-pop.mp3');
  });

  it('swallows fetch failures', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));
    expect(() => playUiSfx('bubblePop')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeAudioContext.instances[0]?.createBufferSource).not.toHaveBeenCalled();
  });

  it('is a no-op when AudioContext is unavailable', async () => {
    vi.resetModules();
    class ThrowingAudioContext {
      constructor() {
        throw new Error('audio not available');
      }
    }
    vi.stubGlobal('AudioContext', ThrowingAudioContext);
    const mod = await import('../../src/utils/uiSfx');
    expect(() => mod.playUiSfx('bubblePop')).not.toThrow();
  });
});
