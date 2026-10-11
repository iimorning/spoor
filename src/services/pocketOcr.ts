/**
 * 口袋拍照的端侧 OCR。
 *
 * 选型：PP-OCRv6_tiny（Apache-2.0，模型 6MB），走 @paddleocr/paddleocr-js。
 * 理由和取舍见 docs 里这次改动的说明——核心是：手机端 `PhoneSettingsModal` 里根本没有 AI
 * 配置入口，走大模型的话没登录的用户直接用不了；口袋"离线、匿名、随手记"的承诺不能破。
 * 代价是首次要下载约 30MB（模型 6 + onnxruntime wasm 14 + OpenCV.js 11），且识别质量
 * 约为 73% W-Avg——纸质文档够用，密集小字会错。
 *
 * 三条硬规矩：
 * 1. 引擎懒加载。`await import` 之前主包里没有 OCR 的任何代码，用户不拍照就不下载。
 * 2. 识别永远不阻塞拍照。引擎起不来（CDN 不通、wasm 被拦、内存不够）就返回 null，
 *    照片照常存进口袋，只是没文本。
 * 3. 读原始 File，不读存进 IndexedDB 的那张 WebP。压缩过的小字识别率会明显下降。
 */
import { toOcrBitmap, type OcrImageSource } from './pocketOcrBitmap';

export type OcrStage = 'loading-engine' | 'recognizing';

/** 识别引擎的对外形状（只取用到的部分，方便测试里替换）。 */
export interface OcrEngine {
  predict(input: unknown): Promise<
    Array<{ items?: Array<{ text?: string; score?: number }> }>
  >;
  dispose?(): Promise<void>;
}

/**
 * 引擎选项。名字必须写全，**不能只给 ocrVersion**：
 * SDK 的 `ocrVersion` 只认 "PP-OCRv5" / "PP-OCRv6"，而 "PP-OCRv6" 映射到的是 **small**
 * 模型（det 9.4MB + rec 20.3MB，对手机太重）。tiny 得用 `textDetectionModelName` /
 * `textRecognitionModelName` 显式点名，它俩在 DEFAULT_MODEL_ASSETS 里是可查的资产名。
 * 另外别传 `lang`：SDK 缺省会补 "ch"，而 "ch" 只在 ocrVersion="PP-OCRv6" 那条路上合法。
 */
export const POCKET_OCR_DET_MODEL = 'PP-OCRv6_tiny_det';
export const POCKET_OCR_REC_MODEL = 'PP-OCRv6_tiny_rec';
/** 识别前先降到这个长边：det 本来也要缩，再喂原始 4000px 纯属白烧时间。 */
export const OCR_MAX_EDGE_PX = 2000;
/** 低于这个置信度的行直接丢，宁可少一句也不要错一句。 */
export const OCR_MIN_SCORE = 0.5;

let enginePromise: Promise<OcrEngine | null> | null = null;
let engineDispose: (() => Promise<void>) | null = null;

/**
 * 测试用：把引擎换掉 / 重置。
 * 不能在这里同步读 engineDispose 来释放旧引擎——引擎可能还在创建中（那时它还是 null），
 * 释放逻辑要等它落地，见 {@link disposeOcrEngine}。
 */
export function __setOcrEngineForTests(engine: OcrEngine | null): void {
  const previous = enginePromise;
  const previousDispose = engineDispose;
  enginePromise = engine ? Promise.resolve(engine) : null;
  engineDispose = null;
  if (!previous) return;
  void previous
    .then((e) => (previousDispose && e ? previousDispose() : undefined))
    .catch(() => {});
}

async function createEngine(onStage?: (stage: OcrStage) => void): Promise<OcrEngine> {
  onStage?.('loading-engine');
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
  const engine = await PaddleOCR.create({
    textDetectionModelName: POCKET_OCR_DET_MODEL,
    textRecognitionModelName: POCKET_OCR_REC_MODEL,
    // worker 模式：onnxruntime + OpenCV 全部离开主线程，手机上不卡 UI。
    worker: true,
    ortOptions: {
      // WebGPU 的 jsep wasm 有 28MB，手机上不划算；固定用 wasm 后端。
      backend: 'wasm',
      // 不能用 SDK 默认的 jsDelivr 路径：它钉在 onnxruntime-web 1.24.3，
      // 而我们装的是 1.30.0，版本错配。由 vite 插件把当前版本发到 /ort/。
      wasmPaths: '/ort/',
      // iOS Safari 没有 SharedArrayBuffer，多线程 wasm 直接不可用；
      // 桌面能开也要先配 COOP/COEP 头，所以这里一律单线程。
      numThreads: 1,
      simd: true,
    },
  });
  engineDispose = typeof engine.dispose === 'function' ? () => engine.dispose!() : null;
  return engine as unknown as OcrEngine;
}

/** 首次调用会下载并初始化引擎（慢），之后复用同一个实例。失败过一次就不再重试到下次会话。 */
export async function ensureOcrEngine(
  onStage?: (stage: OcrStage) => void,
): Promise<OcrEngine | null> {
  if (!enginePromise) {
    enginePromise = createEngine(onStage).catch((e) => {
      console.warn('[Spoor] 端侧 OCR 引擎加载失败，照片将不带文字', e);
      return null;
    });
  }
  return enginePromise;
}

function joinLines(items: Array<{ text?: string; score?: number }>): string {
  return items
    .filter((item) => (item.score ?? 0) >= OCR_MIN_SCORE)
    .map((item) => (item.text ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * 识别一张照片。返回识别到的纯文本；识别不了（引擎没起来 / 图里没字 / 崩了）返回 null，
 * 调用方把它当成"这张照片没有文字"处理，不要当作错误。
 */
export async function recognizeImageText(
  file: File | Blob,
  onStage?: (stage: OcrStage) => void,
): Promise<string | null> {
  const engine = await ensureOcrEngine(onStage);
  if (!engine) return null;
  onStage?.('recognizing');

  let source: OcrImageSource | null = null;
  try {
    source = await toOcrBitmap(file, OCR_MAX_EDGE_PX);
    if (!source) return null;
    const results = await engine.predict(source);
    const text = joinLines(results?.[0]?.items ?? []);
    return text || null;
  } catch (e) {
    console.warn('[Spoor] 端侧 OCR 识别失败', e);
    return null;
  } finally {
    // 缩过尺寸时 toOcrBitmap 给的是 canvas，位图已经在里面关掉了。
    (source as ImageBitmap | null)?.close?.();
  }
}

/** 释放引擎（内存吃紧时用）。 */
export async function disposeOcrEngine(): Promise<void> {
  const pending = enginePromise;
  enginePromise = null;
  engineDispose = null;
  if (!pending) return;
  // engineDispose 要在 await **之后**再读：dispose 是在 createEngine 里、引擎创建完成
  // 那一刻才赋值的。在 await 之前同步读，恰好赶上"引擎正在创建"就会读到 null，
  // 刚建好的引擎连同它那个 11MB 的 worker 就永远不释放了。
  await pending.catch(() => null);
  const dispose = engineDispose;
  engineDispose = null;
  if (dispose) await dispose().catch(() => {});
}
