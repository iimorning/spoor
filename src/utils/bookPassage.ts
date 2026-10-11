import { collectTextNodeCompactMap, compactTtsText } from './ttsFollowAlongDom';

/** CSS Custom Highlight 的注册名；样式写在 `index.css` 的 `::highlight(...)` 里。 */
export const BOOK_PASSAGE_HIGHLIGHT = 'spoor-book-passage';

/** 至少要匹配这么多字符才算命中：太短会在重复文本里误命中。 */
const MIN_NEEDLE_CHARS = 4;

/**
 * 在渲染出来的正文里定位一段摘抄，返回覆盖它的 Range。
 *
 * 比对走「去掉空白与 markdown 符号」的形式（复用 TTS 跟读那套映射）：摘抄存的是
 * 规范化后的文本，DOM 里却保留着原始换行与缩进，直接 `indexOf` 对不上。
 * 一个 Range 可以横跨多个块，所以跨段落的摘抄也能整段覆盖。
 */
export function findPassageRange(container: HTMLElement, passage: string): Range | null {
  const needle = compactTtsText(passage.trim());
  if (needle.length < MIN_NEEDLE_CHARS) return null;
  const { compact, map } = collectTextNodeCompactMap(container);
  const index = compact.indexOf(needle);
  if (index < 0) return null;
  const start = map[index];
  const end = map[index + needle.length - 1];
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/**
 * 把这段文字滚到阅读区中间。返回是否找到了——找不到就停在章节顶部，
 * 章节定位本身总是成功的，滚动只是加分项。
 */
export function scrollPassageIntoView(container: HTMLElement, passage: string): boolean {
  const range = findPassageRange(container, passage);
  if (!range) return false;
  const rect = range.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) return false;
  const box = container.getBoundingClientRect();
  const centered =
    container.scrollTop + (rect.top - box.top) - (container.clientHeight - rect.height) / 2;
  container.scrollTop = Math.max(0, centered);
  return true;
}

/** 行矩形紧贴字形，鼠标停在行间空当里也算还在读这一段，按这个量放宽一点。 */
const RECT_SLACK_PX = 6;

/**
 * 取这段 Range 的行矩形。老浏览器和 jsdom 上 `getClientRects` 压根不存在，
 * 这里当作"没有矩形"，让两个判断各自按"量不到"那条规矩走，而不是抛异常。
 */
function rangeRects(range: Range): DOMRect[] {
  if (typeof range.getClientRects !== 'function') return [];
  return Array.from(range.getClientRects());
}

/**
 * 鼠标是不是压在这段 Range 覆盖的文字上。
 *
 * 量不到矩形（元素还没布局、jsdom）时一律说"不在"：宁可不认定鼠标在这段上，
 * 也不能反过来——那会把刚跳回来的落点提前撤掉。
 */
export function isPointInRange(range: Range, x: number, y: number): boolean {
  const rects = rangeRects(range);
  if (rects.length === 0) return false;
  return rects.some(
    (rect) =>
      x >= rect.left - RECT_SLACK_PX &&
      x <= rect.right + RECT_SLACK_PX &&
      y >= rect.top - RECT_SLACK_PX &&
      y <= rect.bottom + RECT_SLACK_PX,
  );
}

/**
 * 这段 Range 现在还露在容器的可视区里吗。
 *
 * 量不到矩形时当作还在：真实环境里这意味着还没布局，撤高亮为时过早；
 * jsdom 里它让这个判断在测试中是空操作，不会顺手把刚注册的高亮撤掉。
 */
export function isRangeVisibleIn(range: Range, container: HTMLElement): boolean {
  const rects = rangeRects(range).filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) return true;
  const box = container.getBoundingClientRect();
  return rects.some((rect) => rect.bottom > box.top && rect.top < box.bottom);
}
