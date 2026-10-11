import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OCR_MIN_SCORE,
  POCKET_OCR_DET_MODEL,
  POCKET_OCR_REC_MODEL,
  __setOcrEngineForTests,
  disposeOcrEngine,
  recognizeImageText,
  type OcrEngine,
} from '../../src/services/pocketOcr';
import { toOcrBitmap } from '../../src/services/pocketOcrBitmap';

/** jsdom 没有 createImageBitmap，打桩一份能用的。 */
function stubBitmapDecoder(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close })),
  );
  return { close, calls: () => vi.mocked(createImageBitmap).mock.calls };
}

function engineReturning(items: Array<{ text: string; score: number }>): OcrEngine {
  return { predict: vi.fn(async () => [{ items }]) };
}

function jpeg() {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' });
}

describe('pocketOcr', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __setOcrEngineForTests(null);
  });

  afterEach(async () => {
    await disposeOcrEngine();
    vi.unstubAllGlobals();
  });

  it('joins recognised lines into readable text', async () => {
    stubBitmapDecoder(800, 600);
    __setOcrEngineForTests(engineReturning([
      { text: '会议纪要', score: 0.98 },
      { text: '下周上线', score: 0.93 },
    ]));

    expect(await recognizeImageText(jpeg())).toBe('会议纪要\n下周上线');
  });

  // 宁可少一句也不要错一句：低置信度的行是识别错的，混进去比不识别更糟。
  it('drops lines the model is not confident about', async () => {
    stubBitmapDecoder(800, 600);
    __setOcrEngineForTests(engineReturning([
      { text: '认得出的', score: 0.99 },
      { text: '鬼画符', score: OCR_MIN_SCORE - 0.01 },
    ]));

    expect(await recognizeImageText(jpeg())).toBe('认得出的');
  });

  it('reports no text rather than an empty string when the page has none', async () => {
    stubBitmapDecoder(800, 600);
    __setOcrEngineForTests(engineReturning([]));
    expect(await recognizeImageText(jpeg())).toBeNull();
  });

  // 引擎起不来的那条契约在 pocketOcrEngineFailure.test.ts 里（要真的 mock 掉 SDK）。

  it('never throws when recognition blows up', async () => {
    stubBitmapDecoder(800, 600);
    __setOcrEngineForTests({
      predict: vi.fn(async () => {
        throw new Error('wasm trap');
      }),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await recognizeImageText(jpeg())).toBeNull();
  });

  it('reuses one engine across photos instead of reloading it each time', async () => {
    stubBitmapDecoder(800, 600);
    const engine = engineReturning([{ text: 'x', score: 1 }]);
    __setOcrEngineForTests(engine);
    await recognizeImageText(jpeg());
    await recognizeImageText(jpeg());
    expect(engine.predict).toHaveBeenCalledTimes(2);
  });

  it('announces the stage so the UI can say what is happening', async () => {
    stubBitmapDecoder(800, 600);
    __setOcrEngineForTests(engineReturning([{ text: 'x', score: 1 }]));
    const stages: string[] = [];
    await recognizeImageText(jpeg(), (stage) => stages.push(stage));
    expect(stages).toContain('recognizing');
  });
});

describe('toOcrBitmap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // 不认 EXIF 方向的话竖拍照片是躺着的，det 几乎认不出来。
  it('honours the EXIF orientation', async () => {
    const { calls } = stubBitmapDecoder(1000, 2000);
    await toOcrBitmap(jpeg(), 2000);
    expect(calls()[0]?.[1]).toEqual({ imageOrientation: 'from-image' });
  });

  it('keeps the bitmap as-is when it is already small enough', async () => {
    stubBitmapDecoder(1200, 900);
    const out = await toOcrBitmap(jpeg(), 2000);
    expect(out).not.toBeNull();
    expect((out as ImageBitmap).width).toBe(1200);
  });

  it('downsamples a huge photo before the detector sees it', async () => {
    stubBitmapDecoder(4000, 3000);
    const ctx = {
      drawImage: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );

    const out = (await toOcrBitmap(jpeg(), 2000)) as HTMLCanvasElement;
    expect(out.width).toBe(2000);
    expect(out.height).toBe(1500);
    // 小字对缩放质量敏感，默认的 low 会把笔画糊在一起。
    expect(ctx.imageSmoothingQuality).toBe('high');
  });

  it('gives up quietly when the environment cannot decode', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await toOcrBitmap(jpeg(), 2000)).toBeNull();
  });

  it('gives up quietly when decoding throws', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failed');
      }),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await toOcrBitmap(jpeg(), 2000)).toBeNull();
  });
});

describe('pocketOcr engine options', () => {
  /**
   * 防回归。原来写的是 `ocrVersion: 'PP-OCRv6_tiny'`，SDK 会抛
   * "Unsupported lang/ocrVersion combination"——而这个错误被我们吞成 null，
   * 于是 OCR 永远不出字、界面照常跑、所有"失败也不阻塞"的测试还都绿着。
   * 这种错只有让真实 SDK 真跑一遍选项解析才抓得到。
   */
  it('names a model pair the real SDK actually resolves', async () => {
    const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
    const engine = await PaddleOCR.create({
      textDetectionModelName: POCKET_OCR_DET_MODEL,
      textRecognitionModelName: POCKET_OCR_REC_MODEL,
      // 只验选项解析，不下载模型、不起 worker、不初始化 wasm。
      worker: false,
      initialize: false,
    });
    expect(engine).toBeTruthy();
  }, 60_000);

  it('picks the tiny pair, not the small one the SDK defaults v6 to', () => {
    expect(POCKET_OCR_DET_MODEL).toBe('PP-OCRv6_tiny_det');
    expect(POCKET_OCR_REC_MODEL).toBe('PP-OCRv6_tiny_rec');
  });
});
