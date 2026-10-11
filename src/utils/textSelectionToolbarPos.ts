export type TextSelectionToolbarPos = { top: number; left: number; text: string };

type CoordsRect = { top: number; bottom: number; left: number; right: number };

function unionClientRects(rects: DOMRect[]): CoordsRect | null {
  const visible = rects.filter((r) => r.width > 0 && r.height > 0);
  if (visible.length === 0) return null;
  return {
    left: Math.min(...visible.map((r) => r.left)),
    right: Math.max(...visible.map((r) => r.right)),
    top: Math.min(...visible.map((r) => r.top)),
    bottom: Math.max(...visible.map((r) => r.bottom)),
  };
}

function rangeViewportBox(range: Range): CoordsRect | null {
  const union = unionClientRects(Array.from(range.getClientRects()));
  if (union) return union;
  const box = range.getBoundingClientRect();
  if (box.width <= 0 && box.height <= 0) return null;
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
}

function selectionViewportBox(root: HTMLElement | null | undefined): CoordsRect | null {
  if (!root || typeof window === 'undefined') return null;
  const domSel = window.getSelection();
  if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) return null;
  if (!domSel.anchorNode || !domSel.focusNode) return null;
  if (!root.contains(domSel.anchorNode) || !root.contains(domSel.focusNode)) return null;
  return rangeViewportBox(domSel.getRangeAt(0));
}

function pmSelectionViewportBox(
  editor: {
    state: { selection: { from: number; to: number } };
    view: { domAtPos: (pos: number) => { node: Node; offset: number }; dom: HTMLElement };
  },
): CoordsRect | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;
  try {
    const start = editor.view.domAtPos(from);
    const end = editor.view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return rangeViewportBox(range);
  } catch {
    return null;
  }
}

/** Floating essay editor toolbar anchored to a TipTap text selection (viewport px). */
export function computeEssayEditorToolbarPos(
  editor: {
    state: {
      selection: { empty: boolean; from: number; to: number };
      doc: { textBetween: (from: number, to: number, block?: string) => string };
    };
    view: {
      coordsAtPos: (pos: number, side?: number) => CoordsRect;
      /** pmSelectionViewportBox 要用；TipTap 的 EditorView 一直都有。 */
      domAtPos: (pos: number) => { node: Node; offset: number };
      dom: HTMLElement;
    };
  },
  toolbarWidth: number,
  toolbarHeight: number,
  gap = 8,
): { top: number; left: number } | null {
  const { from, to, empty } = editor.state.selection;
  if (empty || from === to) return null;
  const selectedText = editor.state.doc.textBetween(from, to, '\n').trim();
  if (!selectedText) return null;

  const box =
    pmSelectionViewportBox(editor) ?? selectionViewportBox(editor.view.dom);
  let leftEdge: number;
  let rightEdge: number;
  let topEdge: number;
  let bottomEdge: number;
  if (box) {
    leftEdge = box.left;
    rightEdge = box.right;
    topEdge = box.top;
    bottomEdge = box.bottom;
  } else {
    const start = editor.view.coordsAtPos(from, -1);
    const end = editor.view.coordsAtPos(to, 1);
    leftEdge = start.left;
    rightEdge = end.right;
    topEdge = Math.min(start.top, end.top);
    bottomEdge = Math.max(start.bottom, end.bottom);
  }

  let top = topEdge - toolbarHeight - gap;
  if (top < 8) top = bottomEdge + gap;

  let midX = (leftEdge + rightEdge) / 2;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const half = Math.max(40, toolbarWidth / 2);
  midX = Math.min(Math.max(half + 8, midX), Math.max(half + 8, viewportWidth - half - 8));

  return { top, left: midX };
}

/** Place the quote toolbar in the selection host's local CSS px (canvas zoom-aware). */
export function computeTextSelectionToolbarPos(args: {
  range: Partial<Pick<Range, 'getClientRects' | 'getBoundingClientRect'>>;
  positionParent: {
    getBoundingClientRect: () => DOMRect;
    offsetHeight: number;
    clientHeight: number;
    clientWidth: number;
  };
  toolbarWidth: number;
  toolbarHeight: number;
  gap?: number;
}): { top: number; left: number } {
  const { range, positionParent, toolbarWidth, toolbarHeight, gap = 8 } = args;
  const host = positionParent.getBoundingClientRect();
  // Canvas pan/zoom scales screen coords; convert back to local CSS px.
  const scale = host.height / Math.max(1, positionParent.offsetHeight);
  const clientRects =
    typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
  const rects = clientRects.filter((r) => r.width > 0 && r.height > 0);
  const fallbackRect =
    typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : { top: 0, left: 0, bottom: 0, width: 0, height: 0 };
  const first = rects[0] ?? fallbackRect;
  const last = rects[rects.length - 1] ?? first;

  let top = (first.top - host.top) / scale - toolbarHeight - gap;
  if (top < 4) {
    top = (last.bottom - host.top) / scale + gap;
  }
  top = Math.min(Math.max(4, top), Math.max(4, positionParent.clientHeight - toolbarHeight - 4));

  const midX = (first.left + first.width / 2 - host.left) / scale;
  const left = Math.min(
    Math.max(8, midX - toolbarWidth / 2),
    Math.max(8, positionParent.clientWidth - toolbarWidth - 8),
  );
  return { top, left };
}

/** Place the quote toolbar in viewport CSS px (`position: fixed`). No canvas zoom scale. */
export function computeTextSelectionToolbarPosViewport(args: {
  range: Partial<Pick<Range, 'getClientRects' | 'getBoundingClientRect'>>;
  toolbarWidth: number;
  toolbarHeight: number;
  gap?: number;
  clamp: { top: number; left: number; right: number; bottom: number };
}): { top: number; left: number } {
  const { range, toolbarWidth, toolbarHeight, gap = 8, clamp } = args;
  const clientRects =
    typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
  const rects = clientRects.filter((r) => r.width > 0 && r.height > 0);
  const fallbackRect =
    typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : { top: 0, left: 0, bottom: 0, width: 0, height: 0 };
  const first = rects[0] ?? fallbackRect;
  const last = rects[rects.length - 1] ?? first;

  let top = first.top - toolbarHeight - gap;
  if (top < clamp.top + 4) {
    top = last.bottom + gap;
  }
  top = Math.min(Math.max(clamp.top + 4, top), Math.max(clamp.top + 4, clamp.bottom - toolbarHeight - 4));

  const midX = first.left + first.width / 2;
  const left = Math.min(
    Math.max(clamp.left + 8, midX - toolbarWidth / 2),
    Math.max(clamp.left + 8, clamp.right - toolbarWidth - 8),
  );
  return { top, left };
}
