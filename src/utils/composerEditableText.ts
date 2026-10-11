type CaretStop = { node: Node; offset: number };

/**
 * Empty contenteditable hosts often contain a lone `<br>` so the caret has a
 * line box. That is not a user-typed newline and must stay empty.
 */
export function isComposerCaretPlaceholder(el: HTMLElement): boolean {
  let hasNonEmptyText = false;
  let brCount = 0;
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? '').replace(/\u200b/g, '')) hasNonEmptyText = true;
      return;
    }
    if (node.nodeName === 'BR') {
      brCount += 1;
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(el);
  return !hasNonEmptyText && brCount <= 1;
}

/** Plain text of a composer contenteditable, mapping `<br>` / block lines to `\n`. */
export function readComposerEditableText(el: HTMLElement): string {
  if (isComposerCaretPlaceholder(el)) return '';
  return serializeComposerDom(el, null);
}

/** Caret offset in the same coordinate system as `readComposerEditableText`. */
export function readComposerEditableOffset(el: HTMLElement): number {
  if (isComposerCaretPlaceholder(el)) return 0;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (range.startContainer !== el && !el.contains(range.startContainer)) {
    return readComposerEditableText(el).length;
  }
  return serializeComposerDom(el, { node: range.startContainer, offset: range.startOffset }).length;
}

function serializeComposerDom(root: Node, stop: CaretStop | null): string {
  let out = '';
  let stopped = false;

  const append = (chunk: string) => {
    if (stopped) return;
    out += chunk;
  };

  const walk = (node: Node) => {
    if (stopped) return;

    if (stop && node === stop.node) {
      if (node.nodeType === Node.TEXT_NODE) {
        append((node.textContent ?? '').slice(0, Math.max(0, stop.offset)));
        stopped = true;
        return;
      }
      const children = node.childNodes;
      const end = Math.max(0, Math.min(stop.offset, children.length));
      for (let i = 0; i < end; i += 1) walk(children[i]!);
      stopped = true;
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      append(node.textContent ?? '');
      return;
    }
    if (node.nodeName === 'BR') {
      append('\n');
      return;
    }
    if ((node.nodeName === 'DIV' || node.nodeName === 'P') && node !== root) {
      if (out.length > 0 && !out.endsWith('\n')) append('\n');
      node.childNodes.forEach(walk);
      return;
    }
    node.childNodes.forEach(walk);
  };

  walk(root);
  return out.replace(/\u200b/g, '').replace(/\r/g, '');
}
