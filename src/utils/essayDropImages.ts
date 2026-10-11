import { dataImageUrlsInText } from './articleMedia';
import { readFileAsDataURL } from './file';

/**
 * 从桌面、文件管理器、微信里拖进来的图片。
 *
 * 和粘贴共用「先存字节再写引用」那条路（见 `essayPasteImages` 的注释）：Base64 一旦
 * 落进正文就会触发整块正文的媒体迁移重挂。
 *
 * 拖放和粘贴有个绕不开的差别：**`dragover` 阶段拿不到 `files`**（保护模式，只有
 * `types` 可读），所以正文区只能先把所有文件拖放都当成「可能会落图」接下，`drop`
 * 之后才知道里面到底有没有图片。这一层防不住的东西在 `EssayFullscreen` 里处理。
 */

/** 这次拖放带的是哪些图片文件。非图片（txt、pdf…）直接忽略，不猜用户的意图。 */
export function droppedImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const found: File[] = [];
  const seen = new Set<File>();
  for (const file of Array.from(data.files ?? [])) {
    if (!file.type.startsWith('image/') || seen.has(file)) continue;
    seen.add(file);
    found.push(file);
  }
  return found;
}

/**
 * 这次拖放带的是哪些图片，按 Base64 data URL 给出。
 *
 * 文件优先；文件里没有图才去看 `text/html` 里的内嵌 Base64 图——部分来源（例如把图
 * 从聊天窗口里直接拖出来）给的是一张内存里的图而不是磁盘文件。
 */
export async function droppedImageDataUrls(data: DataTransfer | null | undefined): Promise<string[]> {
  if (!data) return [];
  const files = droppedImageFiles(data);
  if (files.length > 0) {
    return Promise.all(files.map((file) => readFileAsDataURL(file)));
  }
  const html = data.getData('text/html') ?? '';
  return html ? dataImageUrlsInText(html) : [];
}