import { collectTextNodeCompactMap, compactTtsText } from './ttsFollowAlongDom';

/** 被标注的那段文字。`mark` 是行内元素，所以照样参与划选和查找。 */
export const BOOK_FOCUS_MARK_ATTR = 'data-book-focus-id';
/** 挂在句子末尾的脚注。绝对定位，不占行、不推开正文。 */
export const BOOK_FOCUS_NOTE_ATTR = 'data-book-focus-note';
/** 脚注里那颗按钮干了什么：`copy` / `delete`。 */
export const BOOK_FOCUS_ACTION_ATTR = 'data-book-focus-action';
/**
 * 脚注记着自己是给哪条标注当注脚的。
 *
 * **不能**复用 `BOOK_FOCUS_MARK_ATTR`：清理和计数都是按那个属性查 `<mark>` 的，
 * 脚注混进去会被当成一段标注来拆——文本会被掏空，列表也会多出一项。
 */
export const BOOK_FOCUS_FOR_ATTR = 'data-book-focus-for';

// 内联 SVG 而非 React 组件：脚注是就地造出来的 DOM，React 管不到它。
// 字面量是写死的、不含任何用户数据，innerHTML 在这里是安全的。
const ICON_COPY =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

/** 少于这么多字符就不当命中，和「跳回原文」那条保持同一个门槛。 */
const MIN_NEEDLE_CHARS = 4;

/**
 * 把正文里的引文包成 `<mark>`，并在句子后面挂一个藏着的脚注。
 *
 * 为什么不是 CSS Custom Highlight：那条路（`BOOK_FOCUS_HIGHLIGHT`）改不了 DOM，
 * 也就挂不上可点的脚注。这里切分文本节点、包 `<mark>`，做法和 TTS 跟读的
 * `wrapTtsSentenceInElement` 是同一套——`<mark>` 是行内元素，划选、查找、
 * 复制全都不受影响，而它是真能点、能挂东西的。
 *
 * 返回实际标上了几处：引文对不上是常事，少标一处不该让其余的也白标。
 */
export function applyBookFocusAnnotations(
  container: HTMLElement,
  marks: Array<{ id: string; quote: string; origin?: 'ai' | 'translate' }>,
): number {
  clearBookFocusAnnotations(container);
  if (marks.length === 0) return 0;
  let applied = 0;
  for (const mark of marks) {
    // 每标一处都要重新取一次映射：上一个 `<mark>` 切分文本节点后，
    // 旧的偏移量就指到已经缩短的节点上去了。
    const { compact, map } = collectTextNodeCompactMap(container);
    const needle = compactTtsText(mark.quote.trim());
    if (needle.length < MIN_NEEDLE_CHARS) continue;
    const from = compact.indexOf(needle);
    if (from < 0) continue;
    // "全文唯一"这条只对 AI 标注有意义：AI 可能随手挑一个撞车的片段，标出去
    // 读者会以为是作者特意强调的。读者自己划的词，出现几次都是他选的那一次意思，
    // 落到第一处即可，不必因为"不唯一"就整条丢掉。
    if (mark.origin !== 'translate' && compact.indexOf(needle, from + 1) >= 0) continue;
    const start = map[from];
    const end = map[from + needle.length - 1];
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    const last = wrapRange(range, mark.id, container);
    if (!last) continue;
    applied += 1;
    // 翻译高亮不挂伴读脚注。再点它时打开的是初次那张翻译浮层
    // （见 BookNode 的 replayStoredTranslation）。脚注会把义项和说明拍成一行。
    if (mark.origin === 'translate') continue;
    const note = document.createElement('span');
    note.setAttribute(BOOK_FOCUS_NOTE_ATTR, '');
    // 正文映射要绕开它，否则这段说明会被当成书里的字，
    // 「跳回原文」的定位会被它顶偏。
    note.setAttribute('data-book-annotation', '');
    note.className = 'book-focus-note';
    note.setAttribute(BOOK_FOCUS_FOR_ATTR, mark.id);
    note.hidden = true;
    const text = document.createElement('span');
    text.className = 'book-focus-note-text';
    note.appendChild(text);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'book-focus-note-btn book-focus-note-copy';
    copy.setAttribute(BOOK_FOCUS_ACTION_ATTR, 'copy');
    copy.innerHTML = ICON_COPY;
    note.appendChild(copy);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'book-focus-note-btn book-focus-note-delete';
    remove.setAttribute(BOOK_FOCUS_ACTION_ATTR, 'delete');
    remove.innerHTML = ICON_TRASH;
    note.appendChild(remove);
    // 挂在**最后**一段的后面：说明跟着句尾走，而不是跟着句首走。
    last.after(note);
  }
  return applied;
}

/**
 * 把一段 Range 包上 `<mark>`，返回最后一段的那个。
 *
 * 一句话被切在两个块里时（EPUB 常见），`<mark>` 是行内元素、装不下 `<div>`，
 * 只能一段一个。它们共用同一个 id：点哪一段，展开的都是同一条说明。
 */
function wrapRange(range: Range, id: string, root: HTMLElement): HTMLElement | null {
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  if (startNode.nodeType !== Node.TEXT_NODE || endNode.nodeType !== Node.TEXT_NODE) return null;
  let start = startNode as Text;
  let end = endNode as Text;
  const from = range.startOffset;
  const to = range.endOffset;
  // 先把两端切到边界上，后面要按"整段"来搬。
  if (start === end) {
    let target = start;
    if (from > 0) target = start.splitText(from);
    const length = to - from;
    if (length < target.data.length) target.splitText(length);
    return wrapText(target, id);
  }
  if (from > 0) start = start.splitText(from);
  // 注意：`splitText` 返回的是**后半段**，原节点留在前半段。所以这里不能接收返回值——
  // 收下就等于把"到 `to` 为止"的边界挪到了 `to` 后面，句末那个句号会被一起圈进去。
  if (to < end.data.length) end.splitText(to);

  // 从正文根节点起走，不是从 start 的父节点：那句话跨了两块，
  // 从块内起走根本够不到下一块，后半句就丢在框外了。
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
  let last: HTMLElement | null = null;
  for (const text of toWrap) {
    last = wrapText(text, id);
  }
  return last;
}

function wrapText(text: Text, id: string): HTMLElement {
  const el = document.createElement('mark');
  el.setAttribute(BOOK_FOCUS_MARK_ATTR, id);
  text.parentNode!.insertBefore(el, text);
  el.appendChild(text);
  return el;
}

/** 把上一轮标上去的 `<mark>` 和脚注拆掉，回到干净的正文。 */
export function clearBookFocusAnnotations(container: HTMLElement): void {
  for (const note of [...container.querySelectorAll(`[${BOOK_FOCUS_NOTE_ATTR}]`)]) {
    note.remove();
  }
  for (const el of [...container.querySelectorAll(`[${BOOK_FOCUS_MARK_ATTR}]`)]) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
  container.normalize();
}

/** 点在脚注自己上面时也算"还在这条标注里"，不该顺手把它收起来。 */
export function isBookFocusNote(node: Node | null): boolean {
  return Boolean(node && (node as Element).closest?.(`[${BOOK_FOCUS_NOTE_ATTR}]`));
}

function noteCopyButton(note: HTMLElement): HTMLElement | null {
  return note.querySelector<HTMLElement>(`[${BOOK_FOCUS_ACTION_ATTR}="copy"]`);
}

/** 复制成功：换成对勾，给个"成了"的交代。 */
export function markBookFocusNoteCopied(note: HTMLElement): void {
  const copy = noteCopyButton(note);
  if (!copy) return;
  copy.innerHTML = ICON_CHECK;
  copy.classList.add('is-done');
}

/** 交代完就换回去——不然这个对勾会一直留着，骗人。 */
export function resetBookFocusNoteCopied(note: HTMLElement): void {
  const copy = noteCopyButton(note);
  if (!copy) return;
  copy.innerHTML = ICON_COPY;
  copy.classList.remove('is-done');
}
