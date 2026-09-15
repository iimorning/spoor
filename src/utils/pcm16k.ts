/** Downsample a mono float stream to 16 kHz by taking every Nth sample. */
export function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    out[i] = input[start] ?? 0;
  }
  return out;
}

export function floatTo16BitPcm(float32: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** Average all channels into one Float32 buffer. */
export function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = Math.max(1, buffer.numberOfChannels);
  const length = buffer.length;
  if (channels === 1) {
    const src = buffer.getChannelData(0);
    return Float32Array.from(src);
  }
  const out = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      out[i] += data[i] ?? 0;
    }
  }
  const inv = 1 / channels;
  for (let i = 0; i < length; i++) out[i] *= inv;
  return out;
}
