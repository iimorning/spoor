import { dataImageUrlsInText } from './articleMedia';
import { readFileAsDataURL } from './file';

/**
 * 粘贴进来的图片必须在落笔前存成ArticleMedia，正文里只留 `spoor-article-media:` 引用。
 *
 * 这不是洁癖：Base64 一旦写进 `article.content`，`articleHasLegacyMedia` 就会把它当成
 * 待迁移的遗留媒体，全屏正文随之切到「迁移中」那一支——编辑器整棵子树被卸载重挂，
 * 光标和滚动都没了。更糟的是重挂后又拿回迁移前的旧 markdown，于是**每敲一个字都重来
 * 一遍**，每轮还会往 media 里多塞一份同样的图。
 *
 * 所以走画布收集那条已经验证过的路子：先存字节，再写引用。
 */

let pasteSeq = 0;

/**
 * 每次粘贴都要一个不和既有 media 撞号的新 id。时间戳保证跨会话唯一，序号兜住同一
 * 毫秒里的第二次粘贴。
 */
export function nextPastedMediaId(): string {
  pasteSeq += 1;
  return `paste-${Date.now().toString(36)}-${pasteSeq}`;
}

/**
 * 这次粘贴带的图片文件。
 *
 * `items` 排在 `files` 前面，和画布粘贴同一个理由：复制一张图时东西在文件槽里，而
 * 在部分浏览器里 `files` 对剪贴板图片是空的，`items` 才拿得到（见
 * `imageFileFromClipboard` 的注释）。
 */
export function pastedImageFiles(event: ClipboardEvent): File[] {
  const data = event.clipboardData;
  if (!data) return [];
  const found: File[] = [];
  const seen = new Set<File>();
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    found.push(file);
  }
  for (const file of Array.from(data.files ?? [])) {
    if (!file.type.startsWith('image/') || seen.has(file)) continue;
    seen.add(file);
    found.push(file);
  }
  return found;
}

/** `text/html` flavour 里的 Base64 图片——从网页复制图片走的是这条。 */
export function pastedHtmlImageUrls(event: ClipboardEvent): string[] {
  const html = event.clipboardData?.getData('text/html') ?? '';
  return html ? dataImageUrlsInText(html) : [];
}

/** 这次粘贴除了图片还带着文字吗。 */
export function pastedText(event: ClipboardEvent): string {
  return event.clipboardData?.getData('text/plain')?.trim() ?? '';
}

/**
 * 该不该拦下这次粘贴。
 *
 * **只有「光秃秃一张图」才拦。** 带图的富文本（从网页复制一段带插图的段落）同时
 * 有 `text/html` 和 `text/plain`，我们只会插图片，不插文字——那样会把人复制来的正文
 * 悄悄吃掉，而且没有撤销可退。宁可放行：那种粘贴退回改动前的行为（正文可能因此带上
 * Base64、触发一次迁移重挂），也不替用户丢内容。丢数据比闪一下严重得多。
 *
 * 同步判定——`handlePaste` 返回 false 就等于把事件还给 ProseMirror，取文件是异步的，
 * 所以必须先同步判一次才能决定拦不拦。
 */
export function shouldInterceptPaste(event: ClipboardEvent): boolean {
  if (pastedText(event)) return false;
  return pastedImageFiles(event).length > 0 || pastedHtmlImageUrls(event).length > 0;
}

/**
 * 这次粘贴带的是哪些图片，按 Base64 data URL 给出。两条路都认：只认文件会漏掉从
 * 网页复制的图，只认 html 会漏掉截图——后者在很多系统上压根不生成 html flavour。
 */
export async function pastedImageDataUrls(event: ClipboardEvent): Promise<string[]> {
  const files = pastedImageFiles(event);
  if (files.length > 0) {
    return Promise.all(files.map((file) => readFileAsDataURL(file)));
  }
  return pastedHtmlImageUrls(event);
}