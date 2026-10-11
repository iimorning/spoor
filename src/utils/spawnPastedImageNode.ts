import { db } from '../db';
import { DEFAULT_NODE_SIZE } from './canvas';
import { readFileAsDataURL } from './file';
import { stampNewCard } from './stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from './syncWorkZoneScopes';

/**
 * 从剪贴板里挑出一张图片。
 *
 * 复制一张图时 `text/plain` 是空的，东西在**文件**槽里——浏览器原生的图片复制
 * 就是这个形状（Chrome 自己还会弹一句"已复制图片"）。画布的粘贴原本只读文本，
 * 于是这种复制会被静默丢掉：按了 Ctrl+V，什么都没发生，也没有报错可查。
 *
 * `items` 排在 `files` 前面：前者带 `kind`/`type`，后者在部分浏览器里对剪贴板
 * 图片是空的。
 */
export function imageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

/** 粘贴一张图片：在落点放一张图片卡，内容按惯例存成 data URL。 */
export async function spawnPastedImageNode(options: {
  file: File;
  canvasId: string;
  position: { x: number; y: number };
}): Promise<string> {
  const id = crypto.randomUUID();
  const [card] = await stampWorkZoneScopeOnNewNodes(
    [
      stampNewCard({
        id,
        canvasId: options.canvasId,
        type: 'image',
        content: await readFileAsDataURL(options.file),
        fileType: options.file.type,
        x: options.position.x,
        y: options.position.y,
        width: DEFAULT_NODE_SIZE.width,
        height: DEFAULT_NODE_SIZE.height,
      }),
    ],
    options.canvasId,
  );
  await db.nodes.add(card);
  return id;
}
