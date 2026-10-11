import { db, type BookExcerpt, type CanvasNode } from '../db';
import { normalizeExtractedPassage } from './sliceSourceMarkdownFromSelection';

/** 单本书最多保留的摘抄条数，超出后丢最旧的。 */
export const BOOK_EXCERPT_CAP = 200;

/** 单条摘抄字数上限，避免一次选中整章把整行撑大。 */
export const BOOK_EXCERPT_MAX_CHARS = 4000;

/** 单条备注字数上限，和摘抄正文同一个量级。 */
export const BOOK_EXCERPT_NOTE_MAX_CHARS = 2000;

/** 摘抄列表存在书籍卡这一行上，读的时候只碰这个字段，不解析 `content`。 */
export function readBookExcerpts(
  node: Pick<CanvasNode, 'bookExcerpts'> | null | undefined,
): BookExcerpt[] {
  return Array.isArray(node?.bookExcerpts) ? node.bookExcerpts : [];
}

export function buildBookExcerpt(options: {
  text: string;
  unitIndex: number;
  unitLabel: string;
  bookTitle: string;
  /** 缺省 `book`（正文里选中的原文）。 */
  source?: 'book' | 'chat';
  now?: number;
}): BookExcerpt | null {
  const text = normalizeExtractedPassage(options.text).slice(0, BOOK_EXCERPT_MAX_CHARS);
  if (!text) return null;
  const source = options.source ?? 'book';
  // 对话来源没有章节可言，别把当前章当成它的出处。
  const unitIndex =
    source === 'chat' || !Number.isFinite(options.unitIndex)
      ? -1
      : Math.max(0, Math.floor(options.unitIndex));
  return {
    id: crypto.randomUUID(),
    text,
    source,
    unitIndex,
    unitLabel: source === 'chat' ? '' : options.unitLabel.trim(),
    bookTitle: options.bookTitle.trim(),
    createdAt: options.now ?? Date.now(),
  };
}

/**
 * 读改写放在一个事务里：连续摘抄时两次 `appendBookExcerpt` 不会互相覆盖。
 * 新增的排最前（和对话框归档一致），这样刚摘的就在栏顶。
 */
async function mutateBookExcerpts(
  nodeId: string,
  mutate: (list: BookExcerpt[]) => BookExcerpt[],
): Promise<BookExcerpt[]> {
  return db.transaction('rw', db.nodes, async () => {
    const node = await db.nodes.get(nodeId);
    if (!node) return [];
    const next = mutate(readBookExcerpts(node));
    await db.nodes.update(nodeId, { bookExcerpts: next });
    return next;
  });
}

export async function appendBookExcerpt(
  nodeId: string,
  excerpt: BookExcerpt,
): Promise<BookExcerpt[]> {
  return mutateBookExcerpts(nodeId, (list) => [excerpt, ...list].slice(0, BOOK_EXCERPT_CAP));
}

export async function removeBookExcerpt(
  nodeId: string,
  excerptId: string,
): Promise<BookExcerpt[]> {
  return removeBookExcerpts(nodeId, [excerptId]);
}

/**
 * 一次删掉若干条摘抄。
 *
 * 多选删除走这一个事务而不是循环调 `removeBookExcerpt`：每条一次事务意味着
 * 连续 N 次读写，而且中途失败会留下删了一半的列表。
 */
export async function removeBookExcerpts(
  nodeId: string,
  excerptIds: string[],
): Promise<BookExcerpt[]> {
  if (excerptIds.length === 0) {
    const node = await db.nodes.get(nodeId);
    return node ? readBookExcerpts(node) : [];
  }
  const doomed = new Set(excerptIds);
  return mutateBookExcerpts(nodeId, (list) => list.filter((row) => !doomed.has(row.id)));
}

/**
 * 待删除的这批书里，一共攒着多少条摘抄。
 *
 * 删除前靠它决定要不要问一句。摘抄存在书籍卡这一行上，删卡就是删它们——
 * 数量是 0 时不该打扰用户：每天要删好几次卡片，为一张空书弹窗只会把人训练成不看。
 */
export function countBookExcerptsInSelection(
  nodes: Array<Pick<CanvasNode, 'id' | 'type'> & { bookExcerpts?: BookExcerpt[] }>,
  ids: Iterable<string>,
): number {
  const doomed = new Set(ids);
  return nodes
    .filter((node) => doomed.has(node.id) && node.type === 'book')
    .reduce((sum, node) => sum + (node.bookExcerpts?.length ?? 0), 0);
}

/** 想法按原样留换行（用户可能分条写），只去首尾空白并截断。 */
export function normalizeBookExcerptNote(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\r\n/g, '\n').trim().slice(0, BOOK_EXCERPT_NOTE_MAX_CHARS);
}

/**
 * 写/清一条摘抄的想法。清空时把 `note` 键整个删掉，而不是留个空串，
 * 这样「这条到底有没有想法」在存储里没有第二种答案。
 */
export async function updateBookExcerptNote(
  nodeId: string,
  excerptId: string,
  raw: string,
): Promise<BookExcerpt[]> {
  const note = normalizeBookExcerptNote(raw);
  return mutateBookExcerpts(nodeId, (list) =>
    list.map((row) => {
      if (row.id !== excerptId) return row;
      if (!note) {
        const next = { ...row };
        delete next.note;
        return next;
      }
      return { ...row, note };
    }),
  );
}

/**
 * 放上画布时卡片正文的拼法：摘抄在前，想法另起一段。
 * 卡片是纯文本（`type: 'text'` 不渲染 markdown），所以标签就是一行普通文字。
 * 没写想法时正文和以前一模一样，别多出一段空标题；
 * 没有正文就返回空串——调用方拿它当"要不要建这张卡"的判断，
 * 光有想法不该造出一张空卡片来。
 */
export function formatExcerptCardContent(
  text: string,
  raw: string | null | undefined,
  noteLabel: string,
): string {
  const passage = text.trim();
  if (!passage) return '';
  const note = normalizeBookExcerptNote(raw);
  if (!note) return passage;
  return `${passage}\n\n${noteLabel}\n${note}`;
}
