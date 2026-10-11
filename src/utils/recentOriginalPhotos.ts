/**
 * 最近拍的原图，只留在内存里。
 *
 * 为什么要有：存进口袋的是压过的 WebP（长边 2000 / q0.8，为了塞进云端单次 512KB 的同步批次），
 * 而端侧 OCR 在原始像素上认小字明显更准。OCR 改成"用户点一下才跑"之后，识别往往发生在
 * 拍照之后一会儿——如果那时原图已经没了，就只能拿压缩图去认，等于白白损失一截识别率。
 *
 * 所以在存图那一刻把 File 顺手留在内存里，识别时优先取。
 * 只留最近几张：手机内存金贵，而且再往前的东西用户多半已经不想识别了。
 * 这不是持久化——重开应用就空了，老照片退回用存下来的压缩图识别，属于预期内的降级。
 */

/** 留几张。手机上一张原图 3–8MB，5 张是"刚拍完顺手识别"这个场景够用又不至于撑住内存的上限。 */
export const RECENT_ORIGINAL_LIMIT = 5;

const recent = new Map<string, File>();

export function rememberOriginalPhoto(photoId: string, file: File): void {
  // Map 保插入序，先删最老的再放新的，天然就是个定长 LRU。
  while (recent.size >= RECENT_ORIGINAL_LIMIT) {
    const oldest = recent.keys().next();
    if (oldest.done) break;
    recent.delete(oldest.value);
  }
  recent.set(photoId, file);
}

/**
 * 只看不删：识别失败时要能再试一次。
 * 早先这里是一取即删，第一次识别失败（比如引擎没起��来）之后原图就没了，
 * 用户再点只能退回用存下来的压缩图，成功率就断在第一次。
 */
export function peekOriginalPhoto(photoId: string): File | undefined {
  return recent.get(photoId);
}

/** 识别成功后才把原图丢掉，不让它一直占着手机内存。 */
export function dropOriginalPhoto(photoId: string): void {
  recent.delete(photoId);
}

export function forgetOriginalPhoto(photoId: string): void {
  recent.delete(photoId);
}

/** 测试用。 */
export function __clearRecentOriginals(): void {
  recent.clear();
}
