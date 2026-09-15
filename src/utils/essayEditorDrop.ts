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
  const hit = editor.view.posAtCoords({ left: clientX, top: clientY });
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
