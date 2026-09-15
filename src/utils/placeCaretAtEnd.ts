/** Move the caret to the end of a textarea/input or contentEditable element. */
export function placeCaretAtEnd(el: HTMLElement): void {
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* some input types (e.g. email in older engines) reject selection */
    }
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Focus a contentEditable node and put the caret at a plain-text offset, without scrolling. */
export function placeCaretAtOffset(el: HTMLElement, offset: number): void {
  el.focus({ preventScroll: true });
  const text = el.firstChild;
  const len = text?.textContent?.length ?? 0;
  const clamped = Math.max(0, Math.min(offset, len));
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (text && text.nodeType === Node.TEXT_NODE) {
    range.setStart(text, clamped);
  } else {
    range.selectNodeContents(el);
    range.collapse(clamped > 0 ? false : true);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Map a click to a character offset inside `root`'s text, or null if the engine cannot resolve it. */
export function textOffsetFromPoint(root: HTMLElement, clientX: number, clientY: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    return null;
  }
  if (!node || (node !== root && !root.contains(node))) return null;
  const prefix = document.createRange();
  try {
    prefix.selectNodeContents(root);
    prefix.setEnd(node, offset);
  } catch {
    return null;
  }
  return prefix.toString().length;
}
