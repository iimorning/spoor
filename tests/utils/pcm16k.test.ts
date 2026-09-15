import { describe, expect, it } from 'vitest';
import { downsampleTo16k, floatTo16BitPcm, mixToMono } from '../../src/utils/pcm16k';

describe('pcm16k', () => {
  it('leaves 16 kHz samples unchanged', () => {
    const input = new Float32Array([0.1, -0.2, 0.3]);
    expect(downsampleTo16k(input, 16000)).toBe(input);
  });

  it('downsamples 48 kHz by taking every third sample', () => {
    const input = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(downsampleTo16k(input, 48000))).toEqual([1, 4, 7]);
  });

  it('encodes clipped floats as little-endian s16', () => {
    const pcm = floatTo16BitPcm(new Float32Array([0, 1, -1, 2]));
    const view = new DataView(pcm.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0x7fff);
    expect(view.getInt16(4, true)).toBe(-0x8000);
    expect(view.getInt16(6, true)).toBe(0x7fff);
  });

  it('averages stereo channels', () => {
    const left = new Float32Array([1, 0]);
    const right = new Float32Array([0, 1]);
    const buffer = {
      numberOfChannels: 2,
      length: 2,
      getChannelData: (c: number) => (c === 0 ? left : right),
    } as unknown as AudioBuffer;
    expect(Array.from(mixToMono(buffer))).toEqual([0.5, 0.5]);
  });
});
