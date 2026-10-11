/**
 * MiniMax 的流式 TTS 回的是裸 PCM16LE（单声道 32 kHz）。想做试听缓存就得把它存下来，
 * 而浏览器能直接播的是带容器头的音频 —— 这里补一个最小 WAV 头（44 字节），
 * 存进 IndexedDB 的 Blob 就能被 `<audio>` 播。
 */
const WAV_HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;

export function pcm16ToWavBytes(
  chunks: Uint8Array[],
  sampleRate: number,
  channels = 1,
): Uint8Array {
  const dataBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const byteRate = (sampleRate * channels * BITS_PER_SAMPLE) / 8;
  const blockAlign = (channels * BITS_PER_SAMPLE) / 8;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (const chunk of chunks) {
    new Uint8Array(buffer, offset, chunk.byteLength).set(chunk);
    offset += chunk.byteLength;
  }

  return new Uint8Array(buffer);
}

/** 要播的时候再包成 Blob（缓存存的是字节，见 voicePreviewCache）。 */
export function pcm16ToWavBlob(chunks: Uint8Array[], sampleRate: number, channels = 1): Blob {
  return new Blob([pcm16ToWavBytes(chunks, sampleRate, channels)], { type: 'audio/wav' });
}
