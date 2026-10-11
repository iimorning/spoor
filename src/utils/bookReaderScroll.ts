/** No continuity overlap: each mouse-wheel page shows entirely new content. */
export const BOOK_READER_SCROLL_OVERLAP_PX = 0;

/** Ignore extra wheel events that fire for a single physical mouse notch. */
export const BOOK_READER_PAGE_LOCK_MS = 320;

/**
 * Detect discrete mouse-wheel notches vs continuous trackpad pixel streams.
 * - LINE / PAGE modes are always treated as discrete.
 * - Pixel mode: notches are commonly ~100–120; trackpads send many small deltas.
 */
export function isDiscreteReaderWheel(e: {
  deltaMode: number;
  deltaY: number;
}): boolean {
  if (e.deltaMode === 1 || e.deltaMode === 2) return true; // DOM_DELTA_LINE / PAGE
  const abs = Math.abs(e.deltaY);
  return abs >= 48 && abs <= 240;
}

/** Distance to advance for one reader "page" (viewport minus continuity overlap). */
export function bookReaderScrollStep(
  clientHeight: number,
  overlapPx = BOOK_READER_SCROLL_OVERLAP_PX,
): number {
  const h = Math.max(0, Math.round(clientHeight));
  const overlap = Math.max(0, Math.min(overlapPx, Math.floor(h / 2)));
  return Math.max(1, h - overlap);
}

export function nextBookReaderScrollTop(options: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  direction: 1 | -1;
  overlapPx?: number;
}): number {
  const step = bookReaderScrollStep(options.clientHeight, options.overlapPx);
  const maxScroll = Math.max(0, options.scrollHeight - options.clientHeight);
  const next = options.scrollTop + options.direction * step;
  return Math.min(maxScroll, Math.max(0, next));
}

/** Large sentinel restored via scrollTop (browser clamps to max). */
export const BOOK_READER_SCROLL_END_SENTINEL = 1_000_000_000;

/**
 * 判定"这一格还能不能继续滚"的容差（px）。
 *
 * 不能直接拿 `nextTop - scrollTop` 和 0 比：`scrollHeight` 与 `clientHeight`
 * 都是**取整值**，两者相减得到的 maxScroll 与浏览器真实可滚距离最多差 1px。
 * 曾经就卡在这里：真机上 scrollHeight=2779 / clientHeight=767 算出 maxScroll=2012，
 * 而浏览器实际只能滚到 2011.2 —— 页面肉眼已经到底，代码却认为还剩 0.8px，
 * 每滚一格都只是把它钳回原地，于是章节永远不翻。
 *
 * 一档就是一屏（数百 px），所以留 2px 容差不会吞掉任何真实滚动。
 */
export const BOOK_READER_EDGE_EPSILON_PX = 2;

/** 从当前 `scrollTop` 滚到 `nextScrollTop` 是否真的能移动内容。 */
export function bookReaderHasRoomToScroll(options: {
  scrollTop: number;
  nextScrollTop: number;
}): boolean {
  return Math.abs(options.nextScrollTop - options.scrollTop) > BOOK_READER_EDGE_EPSILON_PX;
}

/**
 * When in-page scroll cannot move further in `direction`, decide whether wheel
 * should flip chapters. Prefer `canScrollFurther` from comparing nextTop vs scrollTop
 * (more reliable than pixel epsilon at subpixel edges).
 */
export function bookChapterFlipFromWheel(options: {
  canScrollFurther: boolean;
  direction: 1 | -1;
  pageIndex: number;
  pageCount: number;
}): 'next' | 'prev' | null {
  const { canScrollFurther, direction, pageIndex, pageCount } = options;
  if (canScrollFurther || pageCount <= 1) return null;
  if (direction > 0 && pageIndex < pageCount - 1) return 'next';
  if (direction < 0 && pageIndex > 0) return 'prev';
  return null;
}
