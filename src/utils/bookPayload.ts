/** Serialized into CanvasNode.content for type="book". */

export const BOOK_CONTENT_PREFIX = 'spoor-book:v1:';

export type BookHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type BookContentBlock =
  | { type: 'text'; text: string }
  | { type: 'heading'; level: BookHeadingLevel; text: string }
  | { type: 'image'; src: string; alt?: string };

export interface BookUnit {
  /** Page number or chapter title */
  title?: string;
  /** Plain text for selection / AI (images represented as [图] markers). */
  text: string;
  /** Rich chapter body for EPUB (text + inline images). */
  blocks?: BookContentBlock[];
}

export interface BookPayload {
  format: 'pdf' | 'epub';
  title: string;
  units: BookUnit[];
}

/** 摘抄记录与「跳回原文」用的位置标签：有章节名用章节名，否则用 `5 / 21`。 */
export function bookUnitLabel(
  unit: BookUnit | null | undefined,
  index: number,
  count: number,
): string {
  const title = unit?.title?.trim();
  return title || `${index + 1} / ${Math.max(count, 1)}`;
}

function normalizeHeadingLevel(level: unknown): BookHeadingLevel | null {
  const n = typeof level === 'number' ? level : Number(level);
  if (n >= 1 && n <= 6) return n as BookHeadingLevel;
  return null;
}

/**
 * 图片块能用的地址。
 *
 * 这里原来只收 `data:image/`：导入时 EPUB 的图确实是内联 base64 的，那条规则在
 * 同步之前一直成立。但云同步会把这些 base64 传上云、把 `src` 换成云端 URL，
 * **并把换过之后的内容写回本地行**（见 `utils/cloudSyncMedia.ts` 与
 * `applyLocalMediaPatches`）。于是"只认 data URL"就等于：同步跑过一次的书，
 * 再打开一次，图片块被整块丢掉——而且是静默的，界面上只剩文字。
 *
 * 远端地址也得认，`<img src>` 本来两者都吃。云端 URL 走的是 public bucket
 * 的 `getPublicUrl`，不过期，所以认下它之后那些书还能把图找回来。
 *
 * 只放行 http(s) 和 data:image/，别的（`javascript:` 之类）不放行。
 */
function isRenderableImageSrc(src: string): boolean {
  return src.startsWith('data:image/') || /^https?:\/\//i.test(src);
}

function normalizeBlocks(raw: unknown): BookContentBlock[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const blocks: BookContentBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const block = item as {
      type?: unknown;
      text?: unknown;
      src?: unknown;
      alt?: unknown;
      level?: unknown;
    };
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      blocks.push({ type: 'text', text: block.text });
      continue;
    }
    if (block.type === 'heading' && typeof block.text === 'string' && block.text) {
      const level = normalizeHeadingLevel(block.level);
      if (level) blocks.push({ type: 'heading', level, text: block.text });
      continue;
    }
    if (block.type === 'image' && typeof block.src === 'string' && isRenderableImageSrc(block.src)) {
      blocks.push({
        type: 'image',
        src: block.src,
        alt: typeof block.alt === 'string' && block.alt ? block.alt : undefined,
      });
    }
  }
  return blocks.length > 0 ? blocks : undefined;
}

export function encodeBookContent(payload: BookPayload): string {
  return BOOK_CONTENT_PREFIX + JSON.stringify(payload);
}

export function tryParseBookContent(content: string | undefined | null): BookPayload | null {
  if (!content || !content.startsWith(BOOK_CONTENT_PREFIX)) return null;
  try {
    const raw = JSON.parse(content.slice(BOOK_CONTENT_PREFIX.length)) as BookPayload;
    if (!raw || (raw.format !== 'pdf' && raw.format !== 'epub') || !Array.isArray(raw.units)) {
      return null;
    }
    return {
      format: raw.format,
      title: typeof raw.title === 'string' ? raw.title : '',
      units: raw.units
        .filter((u) => u && typeof u.text === 'string')
        .map((u) => ({
          title: typeof u.title === 'string' ? u.title : undefined,
          text: u.text,
          blocks: normalizeBlocks(u.blocks),
        })),
    };
  } catch {
    return null;
  }
}
