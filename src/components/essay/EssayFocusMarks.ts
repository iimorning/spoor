import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EssayFocusMark } from '../../db';
import { findQuoteRange } from '../../utils/essayQuoteRange';

const pluginKey = new PluginKey('essayFocusMarks');

/**
 * 标注列表挂在 storage 上，Decoration 每次重算都从这儿读。
 *
 * 刻意不放"点开回调"在这儿：ProseMirror 的 `handleClick` 要先把鼠标位置换算成文档
 * 位置，编辑器外层的 click 事件拿不到那套换算。所以点击由 `EssayBodyEditor` 在自己
 * 的容器上收——那里能直接 `closest('[data-essay-focus-id]')`，不经过任何坐标推算。
 */
declare module '@tiptap/core' {
  interface Storage {
    essayFocusMarks: { marks: EssayFocusMark[] };
  }
}

/**
 * 正文里那层黄底。
 *
 * 走 **Decoration** 而不是往 DOM 里塞 `<mark>`：正文是活的 ProseMirror 文档，直接改
 * 它的 DOM，下一次 transaction 就会把改掉的东西冲掉，标注会闪一下就没。Decoration 是
 * 视图状态，编辑器自己管生命周期，而且**不碰文档**——所以用户保存下来的 markdown 里
 * 不会混进任何标注标记，导出和复制全文都不受影响。
 *
 * 标注靠引文定位（`findQuoteRange`），不靠偏移量：用户在别处增删文字不会把标好的地方
 * 顶偏；用户把这一句本身改了，就定位不到，这条标注自动不显示——和书籍那边一样，
 * 不迁移也不报错，只是少了它。
 *
 * 定位不到的条目不会出现在这里，但仍然留在 `essayFocusMarks` 里：用户回头把那句话
 * 改回来，标注会自己回来。
 */
export const EssayFocusMarks = Extension.create({
  name: 'essayFocusMarks',

  addStorage() {
    return { marks: [] } as { marks: EssayFocusMark[] };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          decorations: (state) => {
            const stored = this.editor.storage.essayFocusMarks as
              | { marks: EssayFocusMark[] }
              | undefined;
            const marks = stored?.marks ?? [];
            if (marks.length === 0) return DecorationSet.empty;
            const editor = this.editor;
            const items = marks.flatMap((mark) => {
              const range = findQuoteRange(state.doc, mark.quote);
              // 定位不到就跳过这条，其余照常。少了它比整块不渲染好。
              if (!range) return [];
              return [
                Decoration.inline(range.from, range.to, {
                  class: 'essay-focus-mark',
                  'data-essay-focus-id': mark.id,
                }),
              ];
            });
            if (items.length === 0) return DecorationSet.empty;
            return DecorationSet.create(state.doc, items);
          },
        },
      }),
    ];
  },
});
