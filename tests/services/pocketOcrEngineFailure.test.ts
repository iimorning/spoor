import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 引擎加载失败这条路径单独一个文件：它要真的把 SDK mock 成抛错，
 * 而 pocketOcr.test.ts 里那条要 import 真实 SDK 验模型名，两者不能同文件。
 */
const create = vi.fn(async (_options?: unknown) => {
  throw new Error('failed to fetch ort wasm');
});

vi.mock('@paddleocr/paddleocr-js', () => ({
  PaddleOCR: { create: (options: unknown) => create(options) },
}));

import { disposeOcrEngine, recognizeImageText } from '../../src/services/pocketOcr';

function jpeg() {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' });
}

describe('端侧 OCR 引擎加载失败', () => {
  beforeEach(async () => {
    create.mockClear();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await disposeOcrEngine();
  });

  afterEach(async () => {
    await disposeOcrEngine();
    vi.unstubAllGlobals();
  });

  // 手机上 wasm 被拦、CDN 不通、内存不够都很常见。识别是加分项，不能连带把照片搞没。
  it('reports no text instead of throwing at the caller', async () => {
    await expect(recognizeImageText(jpeg())).resolves.toBeNull();
  });

  it('keeps failing gracefully on the next photo too', async () => {
    expect(await recognizeImageText(jpeg())).toBeNull();
    expect(await recognizeImageText(jpeg())).toBeNull();
  });

  // 记住失败结果，别每拍一张就重下一次 30MB。
  it('does not retry the engine load for every photo', async () => {
    await recognizeImageText(jpeg());
    await recognizeImageText(jpeg());
    await recognizeImageText(jpeg());
    expect(create).toHaveBeenCalledTimes(1);
  });
});
