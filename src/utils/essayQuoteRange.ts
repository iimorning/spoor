import type { Node as PmNode } from '@tiptap/pm/model';
import { compactTtsIndexMap, compactTtsText } from './ttsFollowAlongDom';

export type QuoteRange = { from: number; to: number };

/**
 * 在 ProseMirror 文档里定位一段引文。
 *
 * 书籍那边是 `findPassageRange` 在只读 DOM 上做的，ProseMirror 没有对应的东西，所以
 * 这里把文档拼成一段带位置映射的纯文本再搜。定位依据是**引文**而不是偏移量，所以
 * 用户在别处增删文字不会把已经标好的地方顶偏；用户把这一句本身改了，就定位不到，
 * 标注自动不显示——和书籍那边一样的降级方式。
 *
 * 比对走「去掉空白与 markdown 符号」的形式，和 `pickEssayFocusMarks` 校验时用的是
 * 同一个 `compactTtsText`。这条一致性是刻意的：那边判"唯一且存在"，这边就得能
 * 找到同一个位置，否则会出现"校验通过但标不出来"。
 */
export function findQuoteRange(doc: PmNode, quote: string): QuoteRange | null {
  const needle = compactTtsText(quote);
  if (!needle) return null;

  const { flat, indexToChunkOffset } = flattenDocText(doc);
  if (!flat) return null;

  const { compact, map } = compactTtsIndexMap(flat);
  if (!compact) return null;

  const from = compact.indexOf(needle);
  if (from < 0) return null;
  // 出现两次就不知道标哪一处，标错一处比不标更糟。
  if (compact.indexOf(needle, from + 1) >= 0) return null;

  const lastCompact = from + needle.length - 1;
  // map 把 compact 下标还原成 flat 下标。分隔符被 compact 跳过了，所以这两个下标
  // 一定落在真实字符上，不会指向我们自己插的段落空行。
  const startOffset = map[from];
  const endOffset = map[lastCompact];
  if (startOffset == null || endOffset == null) return null;

  const start = indexToChunkOffset(startOffset);
  const end = indexToChunkOffset(endOffset);
  if (start == null || end == null) return null;
  return { from: start.from, to: end.to };
}

/**
 * 把文档拼成一段纯文本，并记下每个字符所在的文本节点及其起始 ProseMirror 位置。
 *
 * 段落之间插 `\n\n`，和 markdown 里段落之间的实际写法一致——模型是从 markdown 里
 * 逐字复制引文的，段落之间原本就是两个换行。
 */
function flattenDocText(doc: PmNode): {
  flat: string;
  indexToChunkOffset: (index: number) => QuoteRange | null;
} {
  let flat = '';
  const chunks: Array<{ start: number; pos: number; len: number }> = [];

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (flat && !flat.endsWith('\n\n')) flat += '\n\n';
    }
    if (node.isText) {
      const text = node.text ?? '';
      if (!text) return true;
      chunks.push({ start: flat.length, pos, len: text.length });
      flat += text;
    }
    return true;
  });

  const indexToChunkOffset = (index: number): QuoteRange | null => {
    for (const chunk of chunks) {
      if (index >= chunk.start && index < chunk.start + chunk.len) {
        const offset = index - chunk.start;
        return { from: chunk.pos + offset, to: chunk.pos + offset + 1 };
      }
    }
    return null;
  };

  return { flat, indexToChunkOffset };
}
