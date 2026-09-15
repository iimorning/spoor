/**
 * contentEditable defaults to pasting rich HTML. Copying from AI Markdown
 * (or other styled nodes) often brings background / font spans that look like
 * gray “shadows” until blur→DB→remount replaces the DOM with plain text.
 * Prefer clipboard plain text so what you see matches what we persist.
 */
export function pastePlainText(e: {
  preventDefault: () => void;
  clipboardData: DataTransfer | null;
}): void {
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!text) return;
  // insertText keeps undo stack in Chromium / WebKit contentEditable.
  if (typeof document.execCommand === 'function') {
    document.execCommand('insertText', false, text);
    return;
  }
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
