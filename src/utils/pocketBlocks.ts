/**
 * 一条口袋备忘的内部结构：一串按顺序排的段，段要么是文字、要么是一张图片。
 *
 * 为什么需要它：用户要的是"上面一段文字、中间插一张图、下面再一段文字"——
 * 也就是一条备忘本身就是个图文混排的文档，而不是"文字便签"和"照片"两张并列的卡片。
 * 早先的口袋一条记录只能是纯文本，于是插图只能变成另一条记录，
 * 用户看到的就是"写完字一拍照，凭空多出一条"，这不是他要的。
 *
 * 这里刻意不 import db：这个文件被 db.ts 当类型用，反向依赖会成环。
 */

export type PocketBlock =
  /**
   * `fromOcr` 记着这段文字是从哪张照片识别来的。
   *
   * 有了它才能"再识别一次"时**改写原来那一段**，而不是在照片底下再堆一段重复的文字。
   */
  | { kind: 'text'; id: string; text: string; fromOcr?: string }
  /** 真正的像素仍然存在一张独立的 image 行上（画布卡片就是它），这里只记顺序。 */
  | { kind: 'image'; id: string; photoId: string };

/** 把识别结果放进文档：插在图片段之后，已经是同一张图识别出来的就原地改写。 */
export function withOcrText(
  blocks: PocketBlock[],
  photoId: string,
  text: string,
): PocketBlock[] {
  const existing = blocks.find((b) => b.kind === 'text' && b.fromOcr === photoId);
  if (existing) {
    return blocks.map((b) => (b.id === existing.id && b.kind === 'text' ? { ...b, text } : b));
  }
  const at = imageIndexOf(blocks, photoId);
  const insertAt = at < 0 ? blocks.length : at + 1;
  return [
    ...blocks.slice(0, insertAt),
    { kind: 'text', id: newBlockId(), text, fromOcr: photoId },
    ...blocks.slice(insertAt),
  ];
}

export function newBlockId(): string {
  return crypto.randomUUID();
}

export function textBlock(text = ''): PocketBlock {
  return { kind: 'text', id: newBlockId(), text };
}

export function imageBlock(photoId: string): PocketBlock {
  return { kind: 'image', id: newBlockId(), photoId };
}

/** 图片在这一串里排在第几段之前/之后。给"插在光标处"用。 */
export function imageIndexOf(blocks: PocketBlock[], photoId: string): number {
  return blocks.findIndex((b) => b.kind === 'image' && b.photoId === photoId);
}

export function photoIdsIn(blocks: PocketBlock[]): string[] {
  return blocks.filter((b) => b.kind === 'image').map((b) => b.photoId);
}

/** 文字块按顺序拼起来，用作列表里的摘要。图片本身不产生文字。 */
export function blocksPlainText(blocks: PocketBlock[]): string {
  return blocks
    .map((b) => (b.kind === 'text' ? b.text : ''))
    .join('\n')
    .trim();
}

export function blocksHaveImages(blocks: PocketBlock[]): boolean {
  return blocks.some((b) => b.kind === 'image');
}

/**
 * 去掉首尾的空文字块，并且只保留"有内容的段"（一张图也算内容）。
 * 首尾那两个空文字块是编辑器为了让人能直接往上/往下打字而留的，不代表用户写了东西。
 */
export function trimBlocks(blocks: PocketBlock[]): PocketBlock[] {
  const hasContent = (b: PocketBlock | undefined): boolean => {
    if (!b) return false;
    return b.kind === 'image' || b.text.trim() !== '';
  };
  // 中间夹着的空文字段：只有当它两侧都有内容时才留，否则会被 trim 掉。
  const out = blocks.filter((b, i) => b.kind === 'image' || b.text.trim() !== '' || (
    hasContent(blocks[i - 1]) && hasContent(blocks[i + 1])
  ));
  // 首尾连续的空文字块清掉
  const isBlankText = (b: PocketBlock | undefined): boolean =>
    !!b && b.kind === 'text' && b.text.trim() === '';
  while (out.length && isBlankText(out[0])) out.shift();
  while (out.length && isBlankText(out[out.length - 1])) out.pop();
  return out;
}

/**
 * 文档以图片结尾时，补一段空的文字段。
 *
 * 空段是**编辑器里才有的落笔处**，不存进库：存的时候 trimBlocks 会把它去掉，
 * 所以下次打开再补一次。少了它，图下面就没有地方打字了——
 * 而"上面一段、中间一张图、下面一段"里的下面那段，正是用户要的。
 */
export function withTrailingTextSlot(blocks: PocketBlock[]): PocketBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.kind === 'image') return [...blocks, { kind: 'text', id: newBlockId(), text: '' }];
  return blocks;
}

/**
 * 把标题变成正文最前面的一段。
 *
 * 画布上的便签只有正文（NoteBody 渲染的就是 content），没有标题的概念。
 * 所以口袋里的独立标题在摆上画布时要并进第一段，否则那行字就凭空消失了。
 */
export function withTitleBlock(blocks: PocketBlock[], title?: string): PocketBlock[] {
  const clean = (title ?? '').trim();
  if (!clean) return blocks;
  // 已经有同名的一段就别再插一遍（重复摆放会走到这里）。
  const first = blocks[0];
  if (first && first.kind === 'text' && first.text.trim() === clean) return blocks;
  return [{ kind: 'text', id: newBlockId(), text: clean }, ...blocks];
}
