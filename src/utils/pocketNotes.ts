import { db, type CanvasNode } from '../db';
import {
  DEFAULT_NODE_SIZE,
  findOpenCanvasPosition,
  type CanvasObstacle,
  type CanvasTransformLike,
} from './canvas';
import { noteContentForEditor } from './noteContentForEditor';
import { stampNewCard } from './stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from './syncWorkZoneScopes';
import { spawnLinkedTranscriptNote } from '../services/spawnLinkedTranscriptNote';
import {
  blocksHaveImages,
  blocksPlainText,
  trimBlocks,
  withTitleBlock,
  type PocketBlock,
} from './pocketBlocks';

/**
 * 口袋：手机上先攒着、还没摆到画布上的条目。既有文字备忘，也有手机拍的照片。
 * 两种条目都是普通的 db.nodes 行，只是 canvasId 记成这个保留值；摆到画布时行本身迁移过去，
 * 所以照片摆下去就是一张现成的图片卡片。
 * Not listed in history.
 */
export const POCKET_CANVAS_ID = '__pocket__';

const POCKET_TITLE_MAX = 48;

export function isPocketCanvasId(id?: string | null): boolean {
  return id === POCKET_CANVAS_ID;
}

export function isPocketNode(node: Pick<CanvasNode, 'canvasId'>): boolean {
  return node.canvasId === POCKET_CANVAS_ID;
}

export function pocketNoteTitle(content: string | undefined | null): string {
  const line = noteContentForEditor(content)
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return '';
  if (line.length <= POCKET_TITLE_MAX) return line;
  return `${line.slice(0, POCKET_TITLE_MAX)}…`;
}

export function pocketNotePreview(content: string | undefined | null): string {
  return noteContentForEditor(content).trim();
}

export function sortPocketNotes(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id));
}

/** Today → time only; older notes → locale date, with year when needed, plus time. */
export function formatPocketTime(ms: number | undefined, locale: string, now = new Date()): string {
  if (!ms) return '';
  const date = new Date(ms);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const sameYear = date.getFullYear() === now.getFullYear();
  const dateStr = date.toLocaleDateString(
    locale,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' },
  );
  return `${dateStr} ${time}`;
}

function isPocketNoteType(type: string | undefined): boolean {
  return type === 'note' || type === 'text';
}

/**
 * 口袋里的图片条目。手机拍照存进来后，行本身就是一条画布图片卡片（type 'image'，
 * content 是 data URL），摆到画布时不用再转换。
 */
function isPocketImageType(type: string | undefined): boolean {
  return type === 'image';
}

function isPocketItemType(type: string | undefined): boolean {
  return isPocketNoteType(type) || isPocketImageType(type);
}

export function isPocketImageNode(node: Pick<CanvasNode, 'type'>): boolean {
  return isPocketImageType(node.type);
}

/** 这张图是不是某条备忘里的一段（而不是一条独立的照片）。 */
export function isPocketImageOwnedBy(node: Pick<CanvasNode, 'ownerMemoId'>, memoId: string): boolean {
  return node.ownerMemoId === memoId;
}

/**
 * 一条备忘的段落。纯文字备忘（老数据、或者用户没插过图）走 content，
 * 不会为了统一而给它造一个 blocks——那样等于把全库老数据都改写一遍。
 */
export function pocketMemoBlocks(node: Pick<CanvasNode, 'blocks' | 'content'>): PocketBlock[] {
  if (node.blocks?.length) return node.blocks;
  return [{ kind: 'text', id: 'legacy', text: node.content ?? '' }];
}

/** 有图的备忘才需要 blocks 字段；只有一段文字的写回 content，保持老的存储形状。 */
export function memoStoragePatch(blocks: PocketBlock[], title?: string): {
  content: string;
  blocks?: PocketBlock[];
  title?: string;
} {
  const trimmed = trimBlocks(blocks);
  const cleanTitle = (title ?? '').trim();
  if (!blocksHaveImages(trimmed)) {
    const text = trimmed.filter((b) => b.kind === 'text').map((b) => b.text).join('\n');
    // 不写 blocks 时必须给一个值而不是 undefined：Dexie 的 update 遇到 undefined
    // 的行为不稳，实测会让这条行从 liveQuery 的结果里整个消失（列表里凭空少一条）。
    return { content: text, blocks: [], title: cleanTitle };
  }
  return { content: '', blocks: trimmed, title: cleanTitle };
}

/**
 * 口袋条目的列表摘要。
 *
 * 备忘：图文混排时把各段文字拼起来（图片本身不产生文字），纯文字时就是 content。
 * 独立照片：它的 content 是整条 data URL，拿内容当预览会得到一屏 base64，
 * 所以改用端侧 OCR 的 ocrText；没识别出东西时是空。
 */
export function pocketItemPreview(
  node: Pick<CanvasNode, 'type' | 'content' | 'ocrText' | 'blocks'>,
): string {
  if (isPocketImageType(node.type)) return (node.ocrText ?? '').trim();
  if (node.blocks?.length) return blocksPlainText(pocketMemoBlocks(node));
  return pocketNotePreview(node.content);
}

/** 列表标题。图片条目的标题由调用方给（要过 i18n），所以单独传进来。 */
export function pocketItemTitle(
  node: Pick<CanvasNode, 'type' | 'content' | 'blocks' | 'title'>,
  photoLabel: string,
): string {
  if (isPocketImageType(node.type)) return photoLabel;
  // 有标题就用标题；老数据没有 title 字段，退回"正文第一行"。
  const title = (node.title ?? '').trim();
  if (title) return title;
  // 图文混排的备忘正文在 blocks 里、content 是空的，标题得从第一段文字取，
  // 否则一条有内容的备忘会顶着"未命名"。
  if (node.blocks?.length) {
    const firstText = node.blocks.find((b) => b.kind === 'text' && b.text.trim());
    return firstText && firstText.kind === 'text' ? pocketNoteTitle(firstText.text) : photoLabel;
  }
  return pocketNoteTitle(node.content);
}

/**
 * 这条口袋记录算不算"有东西"。
 * 照片没有文字摘要，所以不能只看 preview——否则照片会被当成空条目过滤掉，
 * 桌面端的角标、档案库列表和手机端列表都会漏掉它。
 * 图文混排的备忘正文在 blocks 里、content 是空的，也得在这里算进去，
 * 否则整条备忘会在列表里凭空消失。
 */
export function pocketItemHasContent(
  node: Pick<CanvasNode, 'type' | 'content' | 'blocks' | 'title'>,
): boolean {
  if (isPocketImageType(node.type)) return true;
  // 光有标题也算有内容：用户可能只想记个名字。
  if ((node.title ?? '').trim()) return true;
  if (node.blocks?.some((b) => b.kind === 'image' || b.text.trim())) return true;
  return !!pocketNotePreview(node.content);
}

/** 画布图片卡片的默认框宽；竖图再高也不超过 {@link POCKET_IMAGE_CARD_MAX_HEIGHT}。 */
export const POCKET_IMAGE_CARD_WIDTH = 320;
export const POCKET_IMAGE_CARD_MAX_HEIGHT = 480;
/** 拿不到像素尺寸时（老环境没有 createImageBitmap）用的中性比例。 */
export const POCKET_IMAGE_DEFAULT_SIZE = { width: 320, height: 240 };

/**
 * 按图片自身比例给画布定框。ImageNode 用 object-cover 填满卡片，
 * 框的比例和照片不一致就会裁掉边缘，所以这里保比例、只缩不放。
 */
export function pocketImageCardSize(
  width?: number,
  height?: number,
): { width: number; height: number } {
  if (!width || !height || width <= 0 || height <= 0) return { ...POCKET_IMAGE_DEFAULT_SIZE };
  const scale = Math.min(
    POCKET_IMAGE_CARD_WIDTH / width,
    POCKET_IMAGE_CARD_MAX_HEIGHT / height,
    1,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 口袋列表。属于某条备忘的图片**不单独成条**——它是那条备忘里的一段，
 * 跟着备忘一起显示。否则用户写完字一拍照，就会看到凭空多出一条记录。
 */
export async function listPocketNotes(): Promise<CanvasNode[]> {
  const rows = await db.nodes.where('canvasId').equals(POCKET_CANVAS_ID).toArray();
  return sortPocketNotes(
    rows.filter((node) => isPocketItemType(node.type) && !node.ownerMemoId),
  );
}

export async function createPocketNote(content = ''): Promise<string> {
  const id = crypto.randomUUID();
  await db.nodes.add(
    stampNewCard({
      id,
      canvasId: POCKET_CANVAS_ID,
      type: 'note',
      content,
      x: 0,
      y: 0,
    }),
  );
  return id;
}

/**
 * 存一张手机相片进口袋。`dataUrl` 应该已经过 {@link toCanvasImageDataUrl} 压过并带回了尺寸——
 * 原始手机相片有好几 MB，原样塞进 IndexedDB 会撑爆本地库，也过不了云端同步的单批 512KB 上限。
 *
 * `createdAt` 用来控制它在列表里的位置：默认取当前时间（排最前）；编辑某条备忘时传那条的
 * createdAt，相片就会紧挨着出现在它上面。
 */
export async function createPocketImageNote(opts: {
  dataUrl: string;
  width?: number;
  height?: number;
  createdAt?: number;
  ocrText?: string;
  /** 传了就表示这张图是某条备忘里的一段，不会自己出现在口袋列表。 */
  ownerMemoId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const size = pocketImageCardSize(opts.width, opts.height);
  const node: CanvasNode = {
    id,
    canvasId: POCKET_CANVAS_ID,
    type: 'image',
    content: opts.dataUrl,
    fileType: mimeFromPocketDataUrl(opts.dataUrl),
    ocrText: opts.ocrText,
    ownerMemoId: opts.ownerMemoId,
    width: size.width,
    height: size.height,
    x: 0,
    y: 0,
    createdAt: opts.createdAt ?? Date.now(),
  };
  await db.nodes.add(node);
  return id;
}

/**
 * 回填端侧 OCR 的识别结果。拍照是先存图再识别（识别要几秒，照片不能等），
 * 所以这里是事后补写。调用方只在真的认出东西时才调，识别不到就保持 undefined
 * （"这张图没字"和"还没识别"在界面上表现一样，没必要区分）。
 */
export async function updatePocketImageOcrText(id: string, text: string): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node || !isPocketNode(node) || !isPocketImageType(node.type)) return;
  await db.nodes.update(id, { ocrText: text });
}

function mimeFromPocketDataUrl(dataUrl: string): string {
  return /^data:([^;,]+)/i.exec(dataUrl)?.[1] ?? 'image/jpeg';
}

/**
 * 把一条备忘的段落存回去。只有一段文字的写回 `content`（保持老的存储形状，
 * 全库老数据一行不用动）；有图才写 `blocks`，同时把 `content` 清掉，
 * 两者互斥、不会各说各话。
 */
export async function updatePocketMemoBlocks(
  id: string,
  blocks: PocketBlock[],
  title?: string,
): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node || !isPocketNode(node) || !isPocketNoteType(node.type)) return;
  // 标题没传就沿用原来的，避免"只更新正文"把标题抹掉。
  await db.nodes.update(id, memoStoragePatch(blocks, title ?? node.title));
}

/** 删掉一条备忘时，把它内嵌的那些图片行一起清掉，别留孤儿。 */
export async function deletePocketMemo(id: string): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node || !isPocketNode(node)) return;
  const photoIds = node.blocks?.filter((b) => b.kind === 'image').map((b) => b.photoId) ?? [];
  await db.transaction('rw', db.nodes, async () => {
    if (photoIds.length) await db.nodes.bulkDelete(photoIds);
    await db.nodes.delete(id);
  });
}

export async function updatePocketNoteContent(id: string, content: string): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node || !isPocketNode(node) || !isPocketNoteType(node.type)) return;
  await db.nodes.update(id, { content });
}

export async function deletePocketNote(id: string): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node || !isPocketNode(node)) return;
  await db.nodes.delete(id);
}

export async function discardEmptyPocketNotes(exceptId?: string): Promise<void> {
  const rows = await listPocketNotes();
  const doomed = rows.filter((node) => {
    if (node.id === exceptId) return false;
    // 判断"有没有东西"必须走 pocketItemHasContent，不能只看 content：
    // 图文混排的备忘正文在 blocks 里、content 是空的，用 content 判断会把它当成空稿删掉——
    // 而这个清理在每次打开编辑器时都会跑，等于用户一插图，备忘录就没了。
    return !pocketItemHasContent(node);
  });
  if (doomed.length === 0) return;
  await Promise.all(doomed.map((node) => deletePocketMemo(node.id)));
}

/**
 * 把一条口袋记录摆到画布上。
 *
 * 纯文字 / 独立照片：就是它自己那一张卡。
 * 图文混排的备忘：按**阅读顺序**展开成多张卡——文字段落成文字卡，图片段落成图片卡，
 * 从左到右依次排在上一张旁边。用户在手机上写的是一段连续的文档，画布上就该看到
 * 同样连续的顺序，而不是一堆各自为政的卡片。
 */
export async function placePocketNoteOnCanvas(opts: {
  id: string;
  canvasId: string;
  transform: CanvasTransformLike;
  obstacles: CanvasObstacle[];
}): Promise<boolean> {
  if (isPocketCanvasId(opts.canvasId)) return false;
  const node = await db.nodes.get(opts.id);
  if (!node || !isPocketNode(node) || !isPocketItemType(node.type)) return false;
  // 图片条目没有文字摘要，它"有内容"这件事由 isPocketImageType 判定。
  if (!isPocketImageType(node.type) && !pocketItemPreview(node)) return false;

  const blocks = isPocketImageType(node.type) ? null : pocketMemoBlocks(node);
  const images = node.blocks?.filter((b) => b.kind === 'image').map((b) => b.photoId) ?? [];
  if (blocks && images.length > 0) {
    return placePocketMixedMemo(node, withTitleBlock(blocks, node.title), images, opts);
  }

  // 画布上的便签没有标题这个东西，标题并进正文第一行，别让它在摆放时丢掉。
  if (blocks && (node.title ?? '').trim()) {
    const merged = withTitleBlock(blocks, node.title);
    await db.nodes.update(node.id, { content: merged.map((b) => (b.kind === 'text' ? b.text : '')).join('\n'), blocks: [], title: '' });
  }

  const size =
    node.width && node.height && node.width > 0 && node.height > 0
      ? { width: node.width, height: node.height }
      : DEFAULT_NODE_SIZE;
  const { x, y } = findOpenCanvasPosition({
    transform: opts.transform,
    obstacles: opts.obstacles,
    size,
  });
  const [placed] = await stampWorkZoneScopeOnNewNodes(
    [{ ...node, canvasId: opts.canvasId, x, y }],
    opts.canvasId,
  );
  if (!placed) return true;
  await db.nodes.update(opts.id, {
    canvasId: opts.canvasId,
    x,
    y,
    contextScopeAgentId: placed.contextScopeAgentId,
  });
  await spawnOcrNoteBesideImage({ ...node, canvasId: opts.canvasId, x, y }, opts, placed.contextScopeAgentId);
  return true;
}

/**
 * 图文混排备忘的展开：从画布中心开始，按段落顺序一张张排，每张都尽量落在上一张旁边。
 * 已排过的卡片会进 obstacles，后面的段落自然绕开，不会叠上去。
 */
async function placePocketMixedMemo(
  node: CanvasNode,
  blocks: PocketBlock[],
  imageIds: string[],
  opts: { canvasId: string; transform: CanvasTransformLike; obstacles: CanvasObstacle[] },
): Promise<boolean> {
  const obstacles = [...opts.obstacles];
  let anchor: CanvasObstacle | null = null;
  let placedAny = false;

  for (const block of blocks) {
    if (block.kind === 'text') {
      const text = block.text.trim();
      if (!text) continue;
      const size = DEFAULT_NODE_SIZE;
      const { x, y } = findOpenCanvasPosition({
        transform: opts.transform,
        obstacles,
        size,
        preferBeside: anchor,
      });
      const [stamped] = await stampWorkZoneScopeOnNewNodes(
        [{ id: crypto.randomUUID(), canvasId: opts.canvasId, type: 'text', content: text, x, y }],
        opts.canvasId,
      );
      if (!stamped) continue;
      await db.nodes.add({ ...stamped, width: size.width, height: size.height });
      obstacles.push({ type: 'text', x, y, width: size.width, height: size.height });
      anchor = { type: 'text', x, y, width: size.width, height: size.height };
      placedAny = true;
      continue;
    }

    const photo = await db.nodes.get(block.photoId);
    if (!photo || !isPocketImageNode(photo)) continue;
    const size = {
      width: photo.width && photo.width > 0 ? photo.width : POCKET_IMAGE_DEFAULT_SIZE.width,
      height: photo.height && photo.height > 0 ? photo.height : POCKET_IMAGE_DEFAULT_SIZE.height,
    };
    const { x, y } = findOpenCanvasPosition({
      transform: opts.transform,
      obstacles,
      size,
      preferBeside: anchor,
    });
    await db.nodes.update(photo.id, { canvasId: opts.canvasId, x, y, ownerMemoId: undefined });
    obstacles.push({ type: 'image', x, y, width: size.width, height: size.height });
    anchor = { type: 'image', x, y, width: size.width, height: size.height };
    placedAny = true;
    // 照片上的识别文本照旧长一张关联便签
    await spawnOcrNoteBesideImage(
      { ...photo, canvasId: opts.canvasId, x, y },
      { ...opts, obstacles },
    );
  }

  // 原来的备忘行本身已经被展开掉了（它的内容已经变成上面那些卡片）。
  await db.nodes.delete(node.id);
  return placedAny || imageIds.length > 0;
}

/**
 * 照片摆上画布后，用它的识别文本在旁边长一张便签，两张卡连一条边。
 *
 * 复用语音转写那条链路（spawnLinkedTranscriptNote）："这段文字来自那张卡"用一条边表达，
 * 比把一整页文字塞进 ImageNode 的 description 强——那个字段是单行标题，会被截断。
 *
 * 便签继承图片的工作域 scope：它讲的是这张卡的事，就该跟着这张卡所在的房间走。
 */
async function spawnOcrNoteBesideImage(
  placedNode: CanvasNode,
  opts: { canvasId: string; transform: CanvasTransformLike; obstacles: CanvasObstacle[] },
  scopeAgentId?: string,
): Promise<void> {
  // 只有图片才长 OCR 便签：将来别的行也带 ocrText，不该顺手长出一张转写卡。
  if (!isPocketImageType(placedNode.type)) return;
  const text = (placedNode.ocrText ?? '').trim();
  if (!text) return;
  try {
    const noteId = await spawnLinkedTranscriptNote({
      canvasId: opts.canvasId,
      sourceNode: placedNode,
      // opts.obstacles 是**摆放之前**那份，里面没有刚放下去的这张图片。
      // 不把它补进去，findOpenCanvasPosition 看不见自己那张卡，
      // 右边那条道被占时螺旋会绕回来，正好落在图片身上。
      obstacles: [
        ...opts.obstacles,
        {
          type: placedNode.type,
          x: placedNode.x,
          y: placedNode.y,
          width: placedNode.width,
          height: placedNode.height,
        },
      ],
      transform: opts.transform,
      text,
    });
    if (scopeAgentId) await db.nodes.update(noteId, { contextScopeAgentId: scopeAgentId });
  } catch (e) {
    // 识别文本没长出便签不该让"摆照片"整体失败：图已经在画布上了。
    console.error('[Spoor] OCR 便签生成失败', e);
  }
}
