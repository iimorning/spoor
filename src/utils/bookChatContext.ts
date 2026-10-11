import type { BookExcerpt } from '../db';
import type { BookUnit } from './bookPayload';

/** 送进模型的当前章节正文上限（字符）。 */
export const BOOK_CHAT_CHAPTER_CHARS = 6000;
/** 单条摘抄送进模型的上限（字符）。 */
export const BOOK_CHAT_EXCERPT_CHARS = 400;
/** 单条想法送进模型的上限（字符）。 */
export const BOOK_CHAT_EXCERPT_NOTE_CHARS = 400;
/** 最多带几条摘抄。 */
export const BOOK_CHAT_EXCERPT_LIMIT = 12;
/**
 * 模型点名要看摘抄本时放宽到的条数。
 * 平时那 12 条是"顺手附赠最近的几条"，够回答"我刚摘的那句什么意思"；
 * 用户要的是把整个摘抄本摊开给模型看，条数就得跟着走。
 */
export const BOOK_CHAT_EXCERPT_OPEN_LIMIT = 40;

/**
 * 截断当前章节正文；有选中时以选中处为中心开窗，免得选的那段被截掉。
 * 截断处补 `…`，让模型知道这是节选而不是全文。
 */
export function clampBookChatChapter(
  text: string,
  selection = '',
  maxChars = BOOK_CHAT_CHAPTER_CHARS,
): string {
  const body = text.trim();
  if (body.length <= maxChars) return body;
  const needle = selection.replace(/\s+/g, ' ').trim().slice(0, 80);
  const at = needle ? body.indexOf(needle) : -1;
  if (at < 0) return `${body.slice(0, maxChars)}…`;
  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, Math.min(at - half, body.length - maxChars));
  const end = Math.min(body.length, start + maxChars);
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}

/**
 * 摘抄按阅读顺序（旧→新）排，让模型看到的是线性的阅读轨迹。
 * 有想法的摘抄在下一行带上想法，并明确标成用户自己写的判断——
 * 模型要分得清哪句是书里的话，哪句是用户的话。
 * 空列表返回空串，交给提示词里的 "(may be none)" 兜着。
 */
export function formatBookChatExcerpts(
  excerpts: BookExcerpt[],
  noteLabel = 'Note',
  limit = BOOK_CHAT_EXCERPT_LIMIT,
): string {
  const rows = excerpts.slice(0, limit).reverse();
  if (rows.length === 0) return '';
  return rows
    .map((row) => {
      const text = row.text.replace(/\s+/g, ' ').trim().slice(0, BOOK_CHAT_EXCERPT_CHARS);
      const where = row.unitLabel.trim() ? ` (${row.unitLabel.trim()})` : '';
      const note = (row.note ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, BOOK_CHAT_EXCERPT_NOTE_CHARS);
      return `- ${text}${where}${note ? `\n  ${noteLabel}: ${note}` : ''}`;
    })
    .join('\n');
}

/** 打开摘抄本时实际递过去几条——提示词要照实说，别让模型以为那就是全部。 */
export function bookChatOpenExcerptCount(total: number, limit = BOOK_CHAT_EXCERPT_OPEN_LIMIT): number {
  return Math.min(Math.max(total, 0), Math.max(limit, 0));
}

/**
 * 书籍对话的上下文。
 *
 * **这里刻意只接受已经解析好的纯文本**：整本书序列化在 `node.content` 里
 * （`spoor-book:v1:` 前缀 + JSON，图片是内联 base64，单本可达数 MB）。
 * 把 `content` 当上下文塞进 prompt 会直接把请求撑爆，所以入参里没有它，
 * 调用方必须先从 `BookPayload.units[i]` 取 `text`。
 */
export function buildBookChatContext(options: {
  unit: BookUnit | null | undefined;
  selection: string;
  excerpts: BookExcerpt[];
  /** 想法在提示词里的标签，跟着界面语言走。 */
  noteLabel?: string;
  /** 这次最多带几条；模型点名要看摘抄本时由调用方放宽。 */
  excerptLimit?: number;
}): { chapterText: string; excerptsText: string } {
  const selection = options.selection.replace(/\s+/g, ' ').trim();
  return {
    chapterText: clampBookChatChapter(options.unit?.text ?? '', selection),
    excerptsText: formatBookChatExcerpts(
      options.excerpts,
      options.noteLabel,
      options.excerptLimit ?? BOOK_CHAT_EXCERPT_LIMIT,
    ),
  };
}
