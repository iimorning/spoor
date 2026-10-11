/**
 * 给端侧 OCR 准备输入位图。
 *
 * 两件事，都不能省：
 * - `imageOrientation: 'from-image'` 尊重手机相片的 EXIF 方向。不加的话竖拍的照片是躺着的，
 *   det 模型在躺着的文字上几乎认不出来。
 * - 缩到长边 maxEdge。det 本来就要按 textDetLimitSideLen 缩一次，先喂原始 4000px
 *   只是把同一张图多解一遍，手机上白烧几百毫秒。
 */

/** SDK 的 predict 接受 Blob / ImageBitmap / Canvas / ImageData，这里只产出前两个。 */
export type OcrImageSource = ImageBitmap | HTMLCanvasElement;

export async function toOcrBitmap(
  file: File | Blob,
  maxEdge: number,
): Promise<OcrImageSource | null> {
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxEdge) return bitmap;

    const scale = maxEdge / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return bitmap;
    // 密集小字对缩放质量很敏感，默认的 low 会让笔画糊在一起。
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    bitmap = null;
    return canvas;
  } catch (e) {
    console.warn('[Spoor] OCR 输入解码失败', e);
    bitmap?.close?.();
    return null;
  }
}
