import { describe, it, expect, beforeEach } from 'vitest';
import { pcm16ToWavBlob } from '../../src/utils/pcmToWav';
import {
  VOICE_PREVIEW_CACHE_MAX,
  clearVoicePreviewMemoryCache,
  readVoicePreviewClip,
  voicePreviewCacheKey,
  writeVoicePreviewClip,
} from '../../src/utils/voicePreviewCache';
import { db } from '../../src/db';

describe('pcm16ToWavBlob', () => {
  it('按 RIFF 规范写好头，PCM 原样接在后面', async () => {
    const chunk = new Uint8Array([1, 2, 3, 4]);
    const blob = pcm16ToWavBlob([chunk, new Uint8Array([5, 6])], 32_000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, len: number) =>
      String.fromCharCode(...bytes.slice(offset, offset + len));

    expect(blob.type).toBe('audio/wav');
    expect(bytes.byteLength).toBe(44 + 6);
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // 单声道
    expect(view.getUint32(24, true)).toBe(32_000);
    expect(view.getUint16(34, true)).toBe(16); // 位深
    expect(view.getUint32(40, true)).toBe(6); // data 长度
    // 分片按顺序拼在后面
    expect([...bytes.slice(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('没有分片也返回一个合法的空 WAV', async () => {
    const bytes = new Uint8Array(await pcm16ToWavBlob([], 32_000).arrayBuffer());
    expect(bytes.byteLength).toBe(44);
  });
});

describe('voicePreviewCache', () => {
  const key = voicePreviewCacheKey({ model: 'speech-2.6-turbo', voiceId: 'female-yujie', line: '你好。' });

  beforeEach(async () => {
    clearVoicePreviewMemoryCache();
    await db.voicePreviewClips.clear();
  });

  it('键里有模型、音色和样句：样句改了就不会播到旧音频', () => {
    expect(key).toBe('speech-2.6-turbo::female-yujie::你好。');
    expect(
      voicePreviewCacheKey({ model: 'speech-2.6-turbo', voiceId: 'female-yujie', line: '早上好。' }),
    ).not.toBe(key);
  });

  it('写进去能读回来（内存层）', async () => {
    await writeVoicePreviewClip(key, new Uint8Array([1, 2, 3]));
    const clip = await readVoicePreviewClip(key);
    expect(clip).toBeInstanceOf(Blob);
    expect(new Uint8Array(await clip!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('内存层清掉后从 IndexedDB 里读回来 —— 刷新/重开应用仍然命中', async () => {
    await writeVoicePreviewClip(key, new Uint8Array([9, 9]));
    clearVoicePreviewMemoryCache();
    const fromDb = await readVoicePreviewClip(key);
    expect(fromDb).toBeInstanceOf(Blob);
    expect(fromDb!.type).toBe('audio/wav');
    expect(new Uint8Array(await fromDb!.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });

  it('没存过就是 null', async () => {
    expect(await readVoicePreviewClip('missing')).toBeNull();
  });

  it('超过上限时淘汰最老的几条', async () => {
    for (let i = 0; i < VOICE_PREVIEW_CACHE_MAX + 3; i++) {
      clearVoicePreviewMemoryCache();
      await writeVoicePreviewClip(`clip-${i}`, new Uint8Array([i]));
    }
    const rows = await db.voicePreviewClips.toArray();
    expect(rows.length).toBe(VOICE_PREVIEW_CACHE_MAX);
    // 最老的 3 条被清掉，最新的还在
    expect(await db.voicePreviewClips.get('clip-0')).toBeUndefined();
    expect(await db.voicePreviewClips.get('clip-2')).toBeUndefined();
    expect(await db.voicePreviewClips.get(`clip-${VOICE_PREVIEW_CACHE_MAX + 2}`)).toBeTruthy();
  });
});
