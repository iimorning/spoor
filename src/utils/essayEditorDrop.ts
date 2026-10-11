import type { Editor } from '@tiptap/react';

export type EssayDropCaret = {
  left: number;
  top: number;
  height: number;
};

export function resolveEssayEditorDrop(
  editor: Editor,
  clientX: number,
  clientY: number,
): { pos: number; caret: EssayDropCaret } | null {
  const prose = document.querySelector('[data-testid="essay-body-editor-prose"]');
  if (!(prose instanceof HTMLElement)) return null;
  const bounds = prose.getBoundingClientRect();
  if (
    clientX < bounds.left ||
    clientX > bounds.right ||
    clientY < bounds.top ||
    clientY > bounds.bottom
  ) {
    return null;
  }
  // posAtCoords 内部用 document.elementFromPoint 做命中测试；在没有该 API 的环境
  // （jsdom）或视图已卸载时它会直接抛异常。解析不出落点只意味着"这一下没有落点"，
  // 调用方本来就有默认插入位置的回退，不该让整次拖放中断。
  let hit: { pos: number } | null = null;
  try {
    hit = editor.view.posAtCoords({ left: clientX, top: clientY });
  } catch {
    return null;
  }
  if (!hit) return null;
  const coords = editor.view.coordsAtPos(hit.pos);
  return {
    pos: hit.pos,
    caret: {
      left: coords.left,
      top: coords.top,
      height: Math.max(16, coords.bottom - coords.top),
    },
  };
}
