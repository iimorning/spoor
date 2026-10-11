export const TTS_FOLLOW_MARK_ATTR = 'data-tts-mark';

/** Chars that vanish (or are separators) when markdown is rendered — skip when aligning speech to DOM. */
const COMPACT_SKIP = /[\s|#*_>`~\-\[\]()]/u;

export function compactTtsIndexMap(s: string): { compact: string; map: number[] } {
  const map: number[] = [];
  let compact = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (COMPACT_SKIP.test(ch)) continue;
    compact += ch;
    map.push(i);
  }
  return { compact, map };
}

export function compactTtsText(s: string): string {
  return compactTtsIndexMap(s).compact;
}

type CompactHit = { node: Text; offset: number };

/**
 * 把子树里的文本拼成「去掉空白与 markdown 符号」的形式，并记住每个字符来自哪个
 * 文本节点的哪个偏移。用于把一段规范化过的文本（TTS 句子、书籍摘抄）映射回 DOM。
 *
 * `script` / `style` 之外还排除了 `[data-book-annotation]`：那是 AI 伴读挂在句子
 * 末尾的脚注，属于界面而不是书里的字，混进来会把「跳回原文」的定位顶偏。
 */
export function collectTextNodeCompactMap(root: Node): { compact: string; map: CompactHit[] } {
  const map: CompactHit[] = [];
  let compact = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current as Text;
    if (text.parentElement?.closest('script, style, [data-book-annotation]')) continue;
    const value = text.data;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i]!;
      if (COMPACT_SKIP.test(ch)) continue;
      compact += ch;
      map.push({ node: text, offset: i });
    }
  }
  return { compact, map };
}

function extendCompactEnd(compact: string, start: number, matchedLen: number): number {
  let i = start + matchedLen;
  while (i < compact.length && /[。．.！？!?；;]/u.test(compact[i]!)) i += 1;
  return i;
}

export function findCompactSentenceInHaystack(
  compact: string,
  sentence: string,
): { start: number; end: number } | null {
  const needle = compactTtsText(sentence.trim());
  if (!needle) return null;
  let idx = compact.indexOf(needle);
  let matchedLen = needle.length;
  if (idx < 0) {
    const soft = compactTtsText(sentence.trim().replace(/[。．.！？!?；;\n]+$/u, ''));
    if (soft && soft !== needle) {
      idx = compact.indexOf(soft);
      matchedLen = soft.length;
    }
  }
  if (idx < 0) return null;
  return { start: idx, end: extendCompactEnd(compact, idx, matchedLen) };
}

function wrapTextNode(text: Text): HTMLElement {
  const mark = document.createElement('mark');
  mark.setAttribute(TTS_FOLLOW_MARK_ATTR, '');
  text.parentNode!.insertBefore(mark, text);
  mark.appendChild(text);
  return mark;
}

export function unwrapTtsMarks(root: HTMLElement): void {
  const marks = [...root.querySelectorAll(`[${TTS_FOLLOW_MARK_ATTR}]`)];
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  root.normalize();
}

function wrapInclusiveTextNodes(root: Node, start: Text, end: Text): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const toWrap: Text[] = [];
  let started = false;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current as Text;
    if (text === start) started = true;
    if (started && text.data.length > 0) toWrap.push(text);
    if (text === end) break;
  }
  let first: HTMLElement | null = null;
  for (const text of toWrap) {
    const mark = wrapTextNode(text);
    if (!first) first = mark;
  }
  return first;
}

/** Wrap the spoken sentence in rendered markdown. Returns the first mark for scroll-into-view. */
export function wrapTtsSentenceInElement(root: HTMLElement, sentence: string): HTMLElement | null {
  const probe = collectTextNodeCompactMap(root);
  const hit = findCompactSentenceInHaystack(probe.compact, sentence);
  if (!hit) {
    // Keep the last underline if this chunk is markdown chrome / unmatched.
    return root.querySelector(`[${TTS_FOLLOW_MARK_ATTR}]`) as HTMLElement | null;
  }
  unwrapTtsMarks(root);
  const { compact, map } = collectTextNodeCompactMap(root);
  const range = findCompactSentenceInHaystack(compact, sentence);
  if (!range) return null;
  const startHit = map[range.start];
  const endHit = map[range.end - 1];
  if (!startHit || !endHit) return null;

  let startNode = startHit.node;
  let startOffset = startHit.offset;
  let endNode = endHit.node;
  let endOffset = endHit.offset + 1;

  if (startNode === endNode) {
    let target = startNode;
    if (startOffset > 0) target = startNode.splitText(startOffset);
    const length = endOffset - startOffset;
    if (length < target.data.length) target.splitText(length);
    return wrapTextNode(target);
  }

  if (startOffset > 0) startNode = startNode.splitText(startOffset);
  if (endOffset < endNode.data.length) endNode.splitText(endOffset);
  return wrapInclusiveTextNodes(root, startNode, endNode);
}
