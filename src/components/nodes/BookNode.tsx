import { createPortal } from 'react-dom';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  Languages,
  Loader2,
  Maximize2,
  StickyNote,
  Trash2,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import { db, type BookFocusMark } from '../../db';
import { runBookTranslate } from '../../services/bookTranslate';
import { pickTranslatePopoverSide } from '../../utils/bookTranslatePopover';
import {
  lookupEnglishMeanings,
  lookupWord,
  type EnglishDefinition,
} from '../../services/dictionary';
import { spoorLlmSessionId } from '../../utils/openRouterPromptCache';
import type { BookNodeProps } from './types';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import type { BookContentBlock } from '../../utils/bookPayload';
import { bookUnitLabel, tryParseBookContent } from '../../utils/bookPayload';
import { appendBookExcerpt, buildBookExcerpt, readBookExcerpts } from '../../utils/bookExcerpts';
import {
  BOOK_PASSAGE_HIGHLIGHT,
  findPassageRange,
  isPointInRange,
  isRangeVisibleIn,
  scrollPassageIntoView,
} from '../../utils/bookPassage';
import {
  applyBookFocusAnnotations,
  clearBookFocusAnnotations,
  markBookFocusNoteCopied,
  resetBookFocusNoteCopied,
  BOOK_FOCUS_ACTION_ATTR,
  BOOK_FOCUS_FOR_ATTR,
  BOOK_FOCUS_MARK_ATTR,
  BOOK_FOCUS_NOTE_ATTR,
} from '../../utils/bookFocusAnnotation';
import { appendBookTranslateHighlight, readBookFocusMarks, removeBookFocusMarks, splitStoredTranslation } from '../../utils/bookFocusMarks';
import { copyTextToClipboard } from '../../utils/copyTextToClipboard';
import {
  BOOK_READER_PAGE_LOCK_MS,
  BOOK_READER_SCROLL_END_SENTINEL,
  bookChapterFlipFromWheel,
  bookReaderHasRoomToScroll,
  nextBookReaderScrollTop,
} from '../../utils/bookReaderScroll';
import { useTextSelectionToolbar } from '../../hooks/useTextSelectionToolbar';
import { TextSelectionToolbar, TextSelectionToolbarButton } from '../TextSelectionToolbar';

function clampPageIndex(index: number, unitCount: number): number {
  if (unitCount <= 0) return 0;
  return Math.min(Math.max(0, index), unitCount - 1);
}

/**
 * 左栏「跳回原文」用：切章后要等滚动位置恢复（含 80ms 补正）跑完再滚。
 * 必须大于那个补正的延迟。
 */
const BOOK_READER_JUMP_SETTLE_MS = 220;

/**
 * 书内标题阶梯。
 *
 * 原来有六级、跨 1.35rem→0.875rem（21.6→14px），其中 h4/h5/h6 比正文还小或一样大——
 * 标题比正文小，层级就反了。跟着正文收敛到 15px 之后重新定档：
 * 只有三级**尺寸**差异，h4 以下靠字重和间距区分，不再一级一级缩小。
 * 定这条规则时遵守一条：任何标题都不许比正文小。
 */
const HEADING_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'text-[22px] font-bold tracking-wide text-[#2a2a26] leading-snug mt-1 mb-3 first:mt-0',
  2: 'text-[19px] font-bold text-[#2a2a26] leading-snug mt-4 mb-2 first:mt-0',
  3: 'text-[17px] font-semibold text-[#2a2a26] leading-snug mt-3 mb-2 first:mt-0',
  4: 'text-[17px] font-semibold text-[#3a3a34] leading-snug mt-3 mb-1.5 first:mt-0',
  5: 'text-[17px] font-semibold text-[#3a3a34] leading-snug mt-2 mb-1 first:mt-0',
  6: 'text-[17px] font-medium text-[#4a4a44] leading-snug mt-2 mb-1 first:mt-0',
};

function BookUnitBody({
  blocks,
  fallbackText,
}: {
  blocks?: BookContentBlock[];
  fallbackText: string;
}) {
  if (!blocks || blocks.length === 0) {
    return <>{fallbackText}</>;
  }
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'image') {
          return (
            <figure key={`img-${i}`} className="my-3 first:mt-0 last:mb-0">
              <img
                src={block.src}
                alt={block.alt || ''}
                className="max-w-full h-auto mx-auto block rounded-sm"
                draggable={false}
              />
              {block.alt ? (
                <figcaption className="mt-1 text-[11px] font-sans text-[#8c8a84] text-center leading-snug">
                  {block.alt}
                </figcaption>
              ) : null}
            </figure>
          );
        }
        if (block.type === 'heading') {
          const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
          return (
            <Tag key={`h-${i}`} className={HEADING_CLASS[block.level]}>
              {block.text}
            </Tag>
          );
        }
        return (
          <div key={`txt-${i}`} className="whitespace-pre-wrap my-2 first:mt-0 last:mb-0">
            {block.text}
          </div>
        );
      })}
    </>
  );
}

export function BookNode({
  node,
  aiConfig,
  pageNavHost,
  onAskAboutSelection,
  onExpandSelection,
  onExtractSelectionToCard,
  onSelectionPreview,
  isExpanding = false,
  onOpenFullscreen,
  layout = 'card',
  jumpRequest,
  onJumpHighlightDismiss,
}: BookNodeProps) {
  const { t, i18n } = useTranslation();
  const book = useMemo(() => tryParseBookContent(node.content), [node.content]);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 当前展开了脚注的那条标注；null＝全收着。 */
  const [openFocusMark, setOpenFocusMark] = useState<string | null>(null);
  /** id → 引文原文，给"一键复制"用。 */
  const focusQuoteByIdRef = useRef(new Map<string, string>());
  /** 整块书卡（全屏下＝整个阅读栏）。滚轮挂在这里，留白里也能翻页。 */
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 刚跳回来的那一段的 Range；撤高亮时连它一起丢掉。 */
  const passageRangeRef = useRef<Range | null>(null);
  /** 鼠标有没有压过那一段——撤高亮要以此为前提，见 onBodyPointerMove。 */
  const passageHoverRef = useRef(false);
  const dismissPassageHighlightRef = useRef(onJumpHighlightDismiss);
  dismissPassageHighlightRef.current = onJumpHighlightDismiss;
  const ignoreScrollPersistRef = useRef(false);
  const pageScrollLockUntilRef = useRef(0);

  const unitCount = book?.units.length ?? 0;
  /** 卡片模式的摘抄计数徽标；只读数组长度，不解析摘抄内容。 */
  const excerptCount = readBookExcerpts(node).length;
  const storedIndex = typeof node.bookPageIndex === 'number' ? node.bookPageIndex : 0;
  const safeIndex = clampPageIndex(storedIndex, unitCount);
  const unit = book?.units[safeIndex];
  const pageLabel = unit?.title?.trim() || String(safeIndex + 1);
  const sourceLabel = node.description || book?.title || t('nodes.book');
  const selectionSource = `${sourceLabel} · ${pageLabel}`;
  const storedScrollTop = typeof node.bookScrollTop === 'number' ? Math.max(0, node.bookScrollTop) : 0;

  const {
    askUi,
    toolbarRef: askToolbarRef,
    quoteRef: askQuoteRef,
    updateSelectionAsk,
    dismissSelectionToolbar,
    clearAskUi,
    arm: armSelectionToolbar,
    disarm: disarmSelectionToolbar,
  } = useTextSelectionToolbar({
    bodyRef,
    sourceLabel: selectionSource,
    disabled: isExpanding,
    positionMode: layout === 'immersive' ? 'viewport' : 'local',
    clampSelector:
      layout === 'immersive' ? '[data-testid="book-reader-pane"]' : undefined,
  });

  // Keep persisted index in range if book content shrinks after a re-import.
  useEffect(() => {
    if (unitCount <= 0) return;
    if (storedIndex === safeIndex) return;
    void db.nodes.update(node.id, { bookPageIndex: safeIndex, bookScrollTop: 0 });
  }, [node.id, unitCount, storedIndex, safeIndex]);

  // Restore in-page scroll after refresh / page change (not on every liveQuery scroll write).
  useLayoutEffect(() => {
    clearAskUi();
    const el = bodyRef.current;
    if (!el) return;
    const top = storedScrollTop;
    ignoreScrollPersistRef.current = true;
    el.scrollTop = top;
    // Re-apply after images/layout settle so a mid-page position isn't clamped to 0 height.
    const retry = window.setTimeout(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = top;
      ignoreScrollPersistRef.current = false;
    }, 80);
    return () => {
      window.clearTimeout(retry);
      ignoreScrollPersistRef.current = false;
    };
    // Intentionally only when page/node changes — not when bookScrollTop updates from scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, safeIndex]);

  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    };
  }, []);

  const persistScrollTop = useCallback(
    (scrollTop: number) => {
      if (ignoreScrollPersistRef.current) return;
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = setTimeout(() => {
        void db.nodes.update(node.id, { bookScrollTop: Math.max(0, Math.round(scrollTop)) });
      }, 150);
    },
    [node.id],
  );

  const goToPage = useCallback(
    (next: number, scroll: 'start' | 'end' = 'start') => {
      const clamped = clampPageIndex(next, unitCount);
      clearAskUi();
      if (clamped === safeIndex) return;
      void db.nodes.update(node.id, {
        bookPageIndex: clamped,
        bookScrollTop: scroll === 'end' ? BOOK_READER_SCROLL_END_SENTINEL : 0,
      });
    },
    [unitCount, clearAskUi, safeIndex, node.id],
  );

  const goToPageRef = useRef(goToPage);
  goToPageRef.current = goToPage;
  const pageIndexRef = useRef(safeIndex);
  pageIndexRef.current = safeIndex;
  const pageCountRef = useRef(unitCount);
  pageCountRef.current = unitCount;
  const chapterFlipLockUntilRef = useRef(0);

  // Full-viewport in-page jumps; at top/bottom, wheel/arrow flips to prev/next chapter.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // 全屏下正文列被 `max-w-3xl` 限宽居中，两侧留白也属于阅读区。
    // 滚轮只挂在正文上时，鼠标停在留白里滚不动；画布卡片上的正文是满宽的，没有留白，
    // 于是同一个 bug 只在全屏下露出来。所以沉浸模式把监听挂到整块阅读区上。
    const wheelTarget = (layout === 'immersive' ? rootRef.current : null) ?? el;

    const stepPage = (direction: 1 | -1, now: number) => {
      const nextTop = nextBookReaderScrollTop({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        direction,
      });
      const canScrollFurther = bookReaderHasRoomToScroll({
        scrollTop: el.scrollTop,
        nextScrollTop: nextTop,
      });

      const tryChapterFlip = (): boolean => {
        const flip = bookChapterFlipFromWheel({
          canScrollFurther,
          direction,
          pageIndex: pageIndexRef.current,
          pageCount: pageCountRef.current,
        });
        if (!flip) return false;
        if (now < chapterFlipLockUntilRef.current) return true;
        chapterFlipLockUntilRef.current = now + BOOK_READER_PAGE_LOCK_MS;
        pageScrollLockUntilRef.current = now + BOOK_READER_PAGE_LOCK_MS;
        if (flip === 'next') goToPageRef.current(pageIndexRef.current + 1, 'start');
        else goToPageRef.current(pageIndexRef.current - 1, 'end');
        return true;
      };

      if (now < pageScrollLockUntilRef.current) {
        tryChapterFlip();
        return;
      }
      if (canScrollFurther) {
        pageScrollLockUntilRef.current = now + BOOK_READER_PAGE_LOCK_MS;
        el.scrollTop = nextTop;
        return;
      }
      tryChapterFlip();
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (e.deltaY === 0) return;
      const direction: 1 | -1 = e.deltaY > 0 ? 1 : -1;
      stepPage(direction, performance.now());
      e.preventDefault();
      e.stopPropagation();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.shiftKey) return; // shift+arrow = native text selection
      // Left/Right flip chapters directly (same as the bottom chevron buttons).
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        goToPageRef.current(pageIndexRef.current - 1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        goToPageRef.current(pageIndexRef.current + 1);
        return;
      }
      let direction: 1 | -1 | null = null;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') direction = 1;
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') direction = -1;
      if (direction === null) return;
      e.preventDefault();
      e.stopPropagation();
      stepPage(direction, performance.now());
    };

    wheelTarget.addEventListener('wheel', onWheel, { passive: false });
    wheelTarget.addEventListener('keydown', onKeyDown);
    return () => {
      wheelTarget.removeEventListener('wheel', onWheel);
      wheelTarget.removeEventListener('keydown', onKeyDown);
    };
    // unitCount: bodyRef only mounts once parsed book units exist.
  }, [node.id, unitCount, layout]);

  // 左栏「跳回原文」：先切章，等滚动恢复跑完，再尽力把那段文字滚进视野。
  const jumpNonce = jumpRequest?.nonce;
  useEffect(() => {
    if (!jumpRequest) return;
    goToPageRef.current(jumpRequest.unitIndex, 'start');
    const handle = window.setTimeout(() => {
      const el = bodyRef.current;
      if (el) scrollPassageIntoView(el, jumpRequest.text);
    }, BOOK_READER_JUMP_SETTLE_MS);
    return () => window.clearTimeout(handle);
    // nonce 是同一次跳转请求的标识；unitIndex / text 是它的载荷，不需要各自触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpNonce]);

  /**
   * 高亮是用来指路的，不是常驻标记：鼠标在那段上时红底留着，移开就没了。
   * 高亮一旦撤掉，还顺手把这次跳转请求交回外层收掉——留着它的话，用户翻去别的章
   * 再翻回来，高亮会自己长回来。
   */
  const dismissPassageHighlight = useCallback(() => {
    const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
    registry?.delete(BOOK_PASSAGE_HIGHLIGHT);
    passageRangeRef.current = null;
    passageHoverRef.current = false;
    dismissPassageHighlightRef.current?.();
  }, []);

  /**
   * 撤高亮以"鼠标确实压过那段"为前提。
   *
   * 从左栏把鼠标挪进正文，路上先经过的是行间留白和上下留白——那一刻还谈不上
   * "看过了"，按位置一判就把刚跳回来的落点撤掉，用户还没看到就没了。
   * 所以先记下"压过"，之后离开正文或离开这段才算结束。
   */
  const onBodyPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const range = passageRangeRef.current;
      if (!range) return;
      if (isPointInRange(range, e.clientX, e.clientY)) {
        passageHoverRef.current = true;
        return;
      }
      if (passageHoverRef.current) dismissPassageHighlight();
    },
    [dismissPassageHighlight],
  );

  /** 鼠标出了阅读区：落点已经不在视线里了，不用等它压过才撤。 */
  const onBodyPointerLeave = useCallback(() => {
    if (passageRangeRef.current) dismissPassageHighlight();
  }, [dismissPassageHighlight]);

  /**
   * 滚走了就把高亮也带走——这时屏幕上根本看不见它，留着只是白留。
   * 只在鼠标压过那段之后才判：跳转本身的程序化滚动也会走到这里，
   * 那时候落点可能还没滚进视野，不能顺手把它撤了。
   */
  const prunePassageHighlightOnScroll = useCallback(() => {
    const range = passageRangeRef.current;
    const el = bodyRef.current;
    if (!range || !el || !passageHoverRef.current) return;
    if (!isRangeVisibleIn(range, el)) dismissPassageHighlight();
  }, [dismissPassageHighlight]);

  // 跳回原文后把那段标出来——落地了才看得见落点。用 CSS Custom Highlight：
  // 不改文本 DOM，不干扰划选，也不用重渲染。浏览器不支持时只剩滚动，就是原来的行为。
  useEffect(() => {
    const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
    const HighlightCtor = (globalThis as { Highlight?: typeof Highlight }).Highlight;
    if (!registry || typeof HighlightCtor !== 'function') return;
    const passage = (jumpRequest?.text ?? '').trim();
    const el = bodyRef.current;
    // 只在已经翻到目标章节之后标；换章或再次跳转都会重新判定。
    if (!passage || !el || jumpRequest?.unitIndex !== safeIndex) {
      registry.delete(BOOK_PASSAGE_HIGHLIGHT);
      return;
    }
    const range = findPassageRange(el, passage);
    if (!range) {
      registry.delete(BOOK_PASSAGE_HIGHLIGHT);
      return;
    }
    passageRangeRef.current = range;
    passageHoverRef.current = false;
    registry.set(BOOK_PASSAGE_HIGHLIGHT, new HighlightCtor(range));
    return () => {
      registry.delete(BOOK_PASSAGE_HIGHLIGHT);
      passageRangeRef.current = null;
      passageHoverRef.current = false;
    };
  }, [jumpRequest, safeIndex]);

  /**
   * 本章要画的黄底：AI 已经标上的，加上读者自己划词留下的。
   *
   * 换章要重来一次：引文是相对某章正文写的，翻到别的章去对没有意义。
   * 右上角那颗开关**不参与这里**。它只决定还会不会自动再标一章
   * （见 BookFullscreen 里那趟定时调用）。关掉它，已经落在正文上的
   * 重点和翻译高亮都还在——藏起来等于把读者标过的地方弄丢。
   */
  /**
   * 本章要标哪几条，附一个稳定键。
   *
   * 不能把 `node.bookFocusMarks` 直接当依赖：Dexie 的 liveQuery 在**任何**一次
   * `db.nodes` 写入时都会回一份新的行，哪怕写的不是这个字段。于是这个 effect
   * 每写一次就把标注全部拆掉重来（`clearBookFocusAnnotations` 里的 `normalize()`
   * 会合并文本节点）——右栏流式吐字一次就能触发好几轮。
   *
   * 而且它有真代价：文本节点一合并，「跳回原文」那条 CSS Custom Highlight 持有的
   * 活 Range 就会失效——用户刚跳过去看到的那道红底会自己消失。
   */
  const focusMarks = useMemo(
    () => readBookFocusMarks(node).filter((mark) => mark.unitIndex === safeIndex),
    [node.bookFocusMarks, safeIndex],
  );
  const focusMarksKey = focusMarks.map((mark) => `${mark.id}:${mark.quote}`).join('|');

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const applied = applyBookFocusAnnotations(
      el,
      focusMarks.map((mark) => ({
        id: mark.id,
        quote: mark.quote,
        origin: mark.origin,
      })),
    );
    // 存了几条 vs 真在正文里定位到几条——对不上就是引文对不上正文，
    // 而那在界面上和"本来就没标"长得一模一样。
    if (focusMarks.length > 0 || applied > 0) {
      console.info(`[Spoor] AI 伴读标注 · 本章存了 ${focusMarks.length} 条，定位到 ${applied} 条`);
    }
    return () => clearBookFocusAnnotations(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMarksKey, safeIndex]);

  /**
   * 把说明写进脚注、决定它开不开、并在必要时把它挪回可视区内。
   *
   * 脚注是绝对定位、不占行的，所以可能伸出阅读区右缘或下缘。量出来再挪，
   * 而不是猜一个宽度——正文栏宽度是变的，猜的那套在窄屏必错。
   */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const byId = new Map(readBookFocusMarks(node).map((mark) => [mark.id, mark]));
    // 复制要拿的是引文原文，脚注里只有 AI 的批注——所以按 id 留一份原文备着。
    focusQuoteByIdRef.current = new Map(
      [...byId].map(([markId, mark]) => [markId, mark.quote]),
    );
    for (const note of [...el.querySelectorAll<HTMLElement>(`[${BOOK_FOCUS_NOTE_ATTR}]`)]) {
      const anchor = note.previousElementSibling;
      const id = anchor?.getAttribute(BOOK_FOCUS_MARK_ATTR) ?? '';
      const mark = byId.get(id);
      const text = note.querySelector<HTMLElement>('.book-focus-note-text');
      if (text && text.textContent !== (mark?.note ?? '')) text.textContent = mark?.note ?? '';
      // 按钮是就地造出来的 DOM，React 给不了它们名字，只能在这儿补上。
      const copyBtn = note.querySelector<HTMLElement>(
        `[${BOOK_FOCUS_ACTION_ATTR}="copy"]`,
      );
      // 翻译高亮的两颗按钮说的是自己的事：复制的是"原文 + 译文"，
      // 去掉的是那层底色而不是一条标注。说错词用户会以为点错了东西。
      const isTranslate = mark?.origin === 'translate';
      if (copyBtn) {
        copyBtn.title = t(
          isTranslate ? 'reference.book_translate_copy' : 'reference.book_focus_copy',
        );
        copyBtn.setAttribute('aria-label', copyBtn.title);
      }
      const delBtn = note.querySelector<HTMLElement>(`[${BOOK_FOCUS_ACTION_ATTR}="delete"]`);
      if (delBtn) {
        delBtn.title = t(
          isTranslate ? 'reference.book_translate_delete' : 'reference.book_focus_delete',
        );
        delBtn.setAttribute('aria-label', delBtn.title);
      }
      const open = Boolean(id) && id === openFocusMark;
      note.hidden = !open;
      note.classList.toggle('is-open', open);
      if (!open || !anchor) continue;
      /**
       * 摆在句尾。
       *
       * 不能靠 CSS 的 `left:100% / top:100%`：脚注是标注的**兄弟**节点，
       * 不是它的子节点，那套百分比会落到最近的定位祖先上——正文里没有，
       * 于是跑到视口原点去了（表现是贴着屏幕左下角）。
       * 而且 `<mark>` 折行时是行内盒子，百分比相对它算本身就是不确定的。
       * 量出最后一行字的右下角，再换算成正文内容的坐标，就没这些毛病。
       */
      const box = el.getBoundingClientRect();
      const rects = anchor.getClientRects();
      const last = rects.length > 0 ? rects[rects.length - 1] : null;
      if (!last) continue;
      note.style.left = `${Math.max(0, last.left - box.left + el.scrollLeft)}px`;
      // 往下留的那 8px 在 .book-focus-note 的 margin-top 上，这里不再重复加。
      note.style.top = `${last.bottom - box.top + el.scrollTop}px`;
      // 摆完量一次：贴着右缘或贴着下缘的话往回挪，别让它被阅读区切掉。
      const rect = note.getBoundingClientRect();
      const dx = rect.right > box.right - 8 ? box.right - 8 - rect.right : 0;
      const dy = rect.bottom > box.bottom - 8 ? box.bottom - 8 - rect.bottom : 0;
      if (dx || dy) note.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }, [node.bookFocusMarks, openFocusMark, t]);

  // 换章就把展开的那条收起来：它属于上一章的正文，留着会指着一段不相干的话。
  useEffect(() => {
    setOpenFocusMark(null);
  }, [safeIndex]);

  /** 脚注里那颗按钮点了之后换成对勾，一两秒再换回去——给个"成了"的交代。 */
  const copiedNoteTimerRef = useRef<number | null>(null);
  /** 再点翻译高亮时打开初次那张浮层。回调定义在翻译状态之后，点击这里通过 ref 调它。 */
  const replayTranslateRef = useRef<
    (mark: BookFocusMark, anchor: HTMLElement) => void
  >(() => {});
  useEffect(() => () => {
    if (copiedNoteTimerRef.current !== null) window.clearTimeout(copiedNoteTimerRef.current);
  }, []);

  /**
   * 正文上的点击分三种：脚注里的按钮、脚注本身（选字）、标注句（展开/收起）。
   *
   * 前两种必须在这里截住——不然它们会冒泡到 `onBodyClick`，
   * 而那里的判据是"点在不在标注句上"，按钮当然不在，于是脚注会被顺手收起来：
   * 用户刚点下删除，脚注先自己关上了。
   */
  const onBodyClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as Element | null;
      if (!target) return;
      const action = target.closest?.(`[${BOOK_FOCUS_ACTION_ATTR}]`) as HTMLElement | null;
      const noteEl = target.closest?.(`[${BOOK_FOCUS_NOTE_ATTR}]`) as HTMLElement | null;
      if (!action) {
        if (noteEl) return; // 在脚注里选字，别顺手把脚注收了
        const markEl = target.closest?.(`[${BOOK_FOCUS_MARK_ATTR}]`) as HTMLElement | null;
        const id = markEl?.getAttribute(BOOK_FOCUS_MARK_ATTR) ?? '';
        const stored = id ? readBookFocusMarks(node).find((m) => m.id === id) : undefined;
        // 翻译高亮再点一次，打开的是初次那张浮层，不是伴读脚注。
        // 脚注会把义项、译文和说明拍进同一行。
        if (stored?.origin === 'translate' && markEl) {
          setOpenFocusMark(null);
          replayTranslateRef.current(stored, markEl);
          return;
        }
        setOpenFocusMark((current) => (id && id !== current ? id : null));
        return;
      }
      e.stopPropagation();
      const kind = action.getAttribute(BOOK_FOCUS_ACTION_ATTR);
      const note = noteEl ?? action.parentElement;
      const id = note?.getAttribute(BOOK_FOCUS_FOR_ATTR) ?? '';
      if (kind === 'delete') {
        if (!id) return;
        void removeBookFocusMarks(node.id, [id], safeIndex);
        setOpenFocusMark(null);
        return;
      }
      if (kind === 'copy') {
        const quote = focusQuoteByIdRef.current.get(id) ?? '';
        const text = note?.querySelector('.book-focus-note-text')?.textContent ?? '';
        // 原文和译文/批注一起拿走：读者要的是这段话，另一段是附在它上面的东西。
        void copyTextToClipboard(`${quote}

${text}`.trim())
          .then(() => {
            if (!note) return;
            markBookFocusNoteCopied(note);
            if (copiedNoteTimerRef.current !== null) {
              window.clearTimeout(copiedNoteTimerRef.current);
            }
            copiedNoteTimerRef.current = window.setTimeout(() => {
              copiedNoteTimerRef.current = null;
              // 按 id 重新找一次：这一秒里用户可能已经翻章、关了书。
              const live = bodyRef.current?.querySelector<HTMLElement>(
                `[${BOOK_FOCUS_NOTE_ATTR}][${BOOK_FOCUS_FOR_ATTR}="${id}"]`,
              );
              if (live) resetBookFocusNoteCopied(live);
            }, 1600);
          })
          .catch(() => undefined);
      }
    },
    [node, safeIndex],
  );

  /** 点在脚注自己上面时别收——用户可能在选里面的字。 */
  useEffect(() => {
    if (!openFocusMark) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (target as Element).closest?.(
        `[${BOOK_FOCUS_MARK_ATTR}], [${BOOK_FOCUS_NOTE_ATTR}]`,
      )) {
        return;
      }
      setOpenFocusMark(null);
    };
    // 捕获阶段：正文容器上有一个 onPointerDown 是为了选字时别触发画布拖拽，
    // 冒泡监听器会先被它截住，等不到在正文里点的这一下。
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [openFocusMark]);

  // 正文选区变化上报，右栏据此自动显示"AI 会读这一段"——不必再点「问 AI」。
  const onSelectionPreviewRef = useRef(onSelectionPreview);
  onSelectionPreviewRef.current = onSelectionPreview;
  const selectionPreview = askUi?.text ?? '';
  useEffect(() => {
    const report = onSelectionPreviewRef.current;
    if (!report) return;
    if (selectionPreview) {
      report(selectionPreview);
      return;
    }
    // 选区没了：只有焦点还在正文里，才算"用户取消了选中"。
    // 焦点若在右栏输入框里，那只是点了别处，别把已经交给 AI 的那段清掉。
    const body = bodyRef.current;
    if (body && body.contains(document.activeElement)) report('');
  }, [selectionPreview]);

  const runExtractSelection = useCallback(() => {
    const quote = askQuoteRef.current;
    if (!quote || !book) return;
    const unitLabel = bookUnitLabel(unit, safeIndex, unitCount);

    // 画布上的书卡：摘抄就是"把这段话记下来"，落点该是**画布上一张新的卡片**，
    // 而不是书卡内部的一条记录——画布是拿来摆东西的，摘出来的东西就该摆得出来。
    // 思维导图已经是这么做的（onExpandSelection → 卡片 + 边），这里跟它保持一致。
    if (layout === 'card' && onExtractSelectionToCard) {
      onExtractSelectionToCard(quote.text, unitLabel, node.id);
      dismissSelectionToolbar();
      return;
    }

    // 全屏阅读：这里本来就是"书内部"，摘抄记进这本书的摘抄本，左栏能看到。
    // 想上画布的话那边有独立的「放上画布」。
    const excerpt = buildBookExcerpt({
      text: quote.text,
      unitIndex: safeIndex,
      unitLabel,
      bookTitle: book.title || node.description || '',
    });
    if (!excerpt) return;
    void appendBookExcerpt(node.id, excerpt);
    dismissSelectionToolbar();
  }, [
    askQuoteRef,
    book,
    dismissSelectionToolbar,
    layout,
    node.description,
    node.id,
    safeIndex,
    unit,
    unitCount,
  ]);

  const runAskAboutSelection = useCallback(() => {
    const quote = askQuoteRef.current;
    if (!quote || !onAskAboutSelection) return;
    onAskAboutSelection(quote.text, quote.sourceLabel, node.id);
    dismissSelectionToolbar();
  }, [onAskAboutSelection, dismissSelectionToolbar, node.id]);

  /* ---------------------------------------------------------------- *
   * 划词 / 划句翻译
   * ---------------------------------------------------------------- */

  /**
   * 浮层状态。位置在这里自己存一份，不跟着 `askUi` 走：
   * 点了翻译之后工具条要收起来（选区高亮也该退），但浮层得留在原地。
   */
  const [translation, setTranslation] = useState<{
    /** 选区中心 x、上下缘 y（视口坐标）。浮层默认挂在下方，居中对齐。 */
    x: number;
    yTop: number;
    yBottom: number;
    source: string;
    status: 'loading' | 'done' | 'error';
    text: string;
    note: string;
    /** 音标。有它才在义项上方摆一行，并挂一个朗读键。 */
    phonetic?: string;
    /**
     * 顶栏要摆出来的那个词——**只有单词查词才有**。
     *
     * 整段翻译时顶栏是空的：那一段原文在正文里已经亮着，再抄一遍就是把用户
     * 刚要求去掉的东西又加回来。空的时候不占那一行，关闭键改为贴角。
     */
    word?: string;
    /** 英英释义，异步补上来。抓不到就是 undefined，不影响中文那一条。 */
    english?: EnglishDefinition[];
    englishSource?: string;
    /**
     * 再点已经留下的高亮时才有。有它，浮层角落才放复制和去掉高亮；
     * 初次划词那一次不放，排版保持原样。
     */
    markId?: string;
  } | null>(null);
  /**
   * 取消令牌。翻译要好几秒，读者多半等不及就换了选区或者翻走了；没有这个，
   * 旧那一趟的译文会落到新选区上——和伴读标注当初踩的同一个坑。
   */
  const translateRunRef = useRef(0);
  const translationRef = useRef<HTMLDivElement | null>(null);
  /**
   * 浮层贴到屏幕边时往里拉。选择贴着行首或行尾时，居中会让它有一半在屏幕外。
   */
  const [translationShift, setTranslationShift] = useState(0);
  /**
   * 贴边时的两个修正：左右拉回屏幕内，上下在"挂下方"和"翻到上方"之间选。
   *
   * 选区贴着窗口下沿时，往下挂的浮层会被裁掉一半——那还不如翻到选区上方去。
   * 两边都不够（选区几乎占满整屏）才留在下方。
   */
  const [translationAbove, setTranslationAbove] = useState(false);
  /** 再点高亮后点了复制：对勾停一小会儿，告诉读者已经拿走了。 */
  const [replayCopied, setReplayCopied] = useState(false);
  useLayoutEffect(() => {
    const el = translationRef.current;
    if (!translation) {
      setTranslationShift(0);
      setTranslationAbove(false);
      return;
    }
    const margin = 12;
    const gap = 10;
    const half = el.offsetWidth / 2;
    const height = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const lo = half + margin;
    const hi = Math.max(lo, vw - margin - half);
    setTranslationShift(Math.min(Math.max(translation.x, lo), hi) - translation.x);

    setTranslationAbove(
      pickTranslatePopoverSide({
        selectionTop: translation.yTop,
        selectionBottom: translation.yBottom,
        popoverHeight: height,
        viewportHeight: vh,
        margin,
        gap,
      }) === 'above',
    );
  }, [translation]);

  /**
   * 记下"这一段翻过了"，并顺手在正文里留一层高亮。
   *
   * 只在读者还站在这一章时才留——他已经翻到下一章去，标注落在他看不见的地方
   * 没有意义，还会让伴读以为这章处理过。
   */
  const recordTranslateResult = useCallback(
    async (nodeId: string, unitIndexAtStart: number, quote: string, text: string) => {
      if (unitIndexAtStart !== safeIndex) {
        // 读者已经翻走了，落在这里的高亮他看不见，也没人会回来翻到它。
        console.info('[Spoor] 翻译高亮跳过：读者已不在这一章', {
          quote,
          at: unitIndexAtStart,
          now: safeIndex,
        });
        return;
      }
      try {
        await appendBookTranslateHighlight(
          nodeId,
          unitIndexAtStart,
          { quote, note: '' },
          text,
        );
      } catch (e) {
        // 高亮只是回看的路标，记不上不该把译文一起吞掉。
        console.error('[Spoor] 翻译高亮写入失败', e);
      }
    },
    [safeIndex],
  );

  /**
   * 念一遍这个词。
   *
   * ECDICT 的 `audio` 列是空的——全库七十七条一条都没有（它的 README 里就标着
   * "待添加"），所以不能指望词库自带发音。这里用浏览器自带的语音合成：不要 key、
   * 不花钱、网页和桌面都能用。音质比不上真人录音，但查词这件事里够用了。
   */
  const speakWord = useCallback((text: string, audioUrl?: string) => {
    const word = text.trim();
    if (!word) return;
    // 有真人录音就用它。ECDICT 自带的 audio 列全空，但 Free Dictionary 会给录音，
    // 音质差距很大——所以只在没有录音时才退到合成语音。
    if (audioUrl) {
      try {
        const a = new Audio(audioUrl);
        void a.play().catch((e) => console.info('[Spoor] 录音播放失败，改用合成语音：', e));
        return;
      } catch {
        // 落到下面
      }
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-GB';
        const voice = window.speechSynthesis.getVoices().find((v) => /^en[-_]GB/i.test(v.lang));
      if (voice) u.voice = voice;
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.info('[Spoor] 朗读失败：', e);
    }
  }, []);

  const closeTranslation = useCallback(() => {
    translateRunRef.current += 1;
    setTranslation(null);
  }, []);

  /**
   * 再点一条翻译高亮，打开和初次划词同一张浮层。
   *
   * 单词重新查一次本地词表：音标、朗读和分行的义项都在那里，存下来的那串字
   * 没有这些。整句则把当初拼进 note 的「译文 + 空行 + 说明」拆开，各自归位。
   */
  const replayStoredTranslation = useCallback((mark: BookFocusMark, anchor: HTMLElement) => {
    const rects = typeof anchor.getClientRects === 'function' ? anchor.getClientRects() : [];
    const last = rects.length > 0 ? rects[rects.length - 1] : anchor.getBoundingClientRect();
    const anchorX = last.left + last.width / 2;
    const anchorTop = last.top;
    const anchorBottom = last.bottom;
    dismissSelectionToolbar();
    setReplayCopied(false);
    const token = ++translateRunRef.current;
    void (async () => {
      const dict = await lookupWord(mark.quote);
      if (translateRunRef.current !== token) return;
      if (dict.via === 'word' && dict.ecdict) {
        const hit = dict.ecdict;
        setTranslation({
          x: anchorX,
          yTop: anchorTop,
          yBottom: anchorBottom,
          source: mark.quote,
          status: 'done',
          text: hit.t,
          note: '',
          phonetic: hit.p,
          word: mark.quote.trim(),
          markId: mark.id,
        });
        void lookupEnglishMeanings(mark.quote).then((en) => {
          if (translateRunRef.current !== token || !en) return;
          setTranslation((cur) =>
            cur && cur.markId === mark.id && translateRunRef.current === token
              ? { ...cur, english: en.definitions, englishSource: en.sourceLabel }
              : cur,
          );
        });
        return;
      }
      const parts = splitStoredTranslation(mark.note);
      setTranslation({
        x: anchorX,
        yTop: anchorTop,
        yBottom: anchorBottom,
        source: mark.quote,
        status: 'done',
        text: parts.text,
        note: parts.note,
        markId: mark.id,
      });
    })();
  }, [dismissSelectionToolbar]);
  replayTranslateRef.current = replayStoredTranslation;

  const runTranslateSelection = useCallback(async () => {
    const uiLang = i18n?.language ?? 'zh';
    const quote = askQuoteRef.current;
    const at = askUi;
    if (!quote || !at || !aiConfig || !unit) return;
    // 锚点要取**选区自己**的矩形，不能复用 askUi。
    // askUi 是给工具条算的：left 是工具条的左边缘（midX - 宽度/2 再夹紧），
    // top 已经把工具条放在选区**上方**了。拿它当锚点，浮层会既左偏又偏上。
    // getClientRects / getBoundingClientRect 得先问有没有——和
    // textSelectionToolbarPos 里一样的口径，jsdom 的 Range 就没有。
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const rect =
      range && typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : null;
    const anchorX = rect && rect.width > 0 ? rect.left + rect.width / 2 : at.left;
    const anchorTop = rect && rect.height > 0 ? rect.top : at.top + 32;
    const anchorBottom = rect && rect.height > 0 ? rect.bottom : at.top + 64;
    const source = quote.text;
    const unitAtStart = safeIndex;
    const bodyAtStart = unit.text;
    const token = ++translateRunRef.current;
    setTranslation({ x: anchorX, yTop: anchorTop, yBottom: anchorBottom, source, status: 'loading', text: '', note: '' });
    dismissSelectionToolbar();
    // 单词先查本地词表：划到生词是最常见的场景，而查词典是瞬时、免费、离线
    // 可用的，调模型要好几秒还花钱。词表里没有、或者划的是整句，再走模型。
    const dict = await lookupWord(source);
    if (translateRunRef.current !== token) return;
    if (dict.via === 'word' && dict.ecdict) {
      const hit = dict.ecdict;
      // 音标由 phonetic 单独渲染，lines 里只放义项——放两遍浮层会显示两次音标。
      const lines = hit.t;
      console.info('[Spoor] 查词命中本地词表', { source, matched: hit.w });
      // 划过的词也要在正文里留底色，否则浮层一关就找不回是哪一段。
      // 不 await：查词的全部意义就是瞬时，不能为一次写库把答案押住。
      console.info('[Spoor] 查词命中本地词表', { source, matched: hit.w });
      void recordTranslateResult(node.id, unitAtStart, source, lines);
      setTranslation({
        x: anchorX,
        yTop: anchorTop,
        yBottom: anchorBottom,
        source,
        status: 'done',
        text: lines,
        note: '',
        phonetic: hit.p,
        word: source.trim(),
      });
      // 英英释义是**补充**：要现抓外部词典，慢而且不稳。所以中文义项先落地，
      // 英文释义拿到再补上去——读者不用等它，抓不到也不影响上面那一条。
      const tokenAt = token;
      void lookupEnglishMeanings(source).then((en) => {
        if (translateRunRef.current !== tokenAt || !en) return;
        setTranslation((cur) =>
          cur && translateRunRef.current === tokenAt
            ? { ...cur, english: en.definitions, englishSource: en.sourceLabel }
            : cur,
        );
      });
      return;
    }
    try {
      const result = await runBookTranslate({
        config: aiConfig,
        title: sourceLabel,
        selection: source,
        body: bodyAtStart,
        // 目标语言跟界面语言走：读者在中文界面里读书，多半就想看中文。
        // `i18n?.` 不是防御性洁癖：不少测试的 react-i18next mock 只给了 t，
        // 社区页和两个落地页读语言时也都带可选链。裸取会把整个书卡打挂。
        targetLang: uiLang,
        sourceLang: uiLang,
        sessionId: spoorLlmSessionId('book-translate', node.id),
        // 流式：模型还在写，浮层上就跟着长。等整段收完再显示，读者面对的是一个
        // 空转圈十几秒——现在至少从第一秒起就有字在动。
        // 传空串是"重试了，从头来"，所以这里不能对空串提前 return。
        onPartial: (partial) => {
          if (translateRunRef.current !== token) return;
          setTranslation((cur) =>
            cur && cur.status === 'loading' ? { ...cur, text: partial } : cur,
          );
        },
      });
      if (translateRunRef.current !== token) return;
      if (!result.translation) {
        // 这条分支以前一句日志都不写：界面上写着"没翻出来"，控制台干干净净，
        // 于是"翻不出来"和"翻出来了但高亮没落上"看起来一模一样，排查只能靠猜。
        console.warn('[Spoor] 划词翻译没有返回译文', {
          source,
          note: result.note,
          provider: aiConfig?.provider,
          model: aiConfig?.model,
        });
        // 流式把译文送到读者眼前了，收尾时又解析不出来（比如模型多吐了半截废话），
        // 这时候抹掉等于让刚才那几秒白等。留着它，读者至少读到了东西。
        setTranslation((cur) => ({
          x: anchorX,
          yTop: anchorTop,
          yBottom: anchorBottom,
          source,
          status: 'error',
          text: cur?.text ?? '',
          note: t('reference.book_translate_empty'),
        }));
        return;
      }
      // 译完把这一段留在正文里：浮层一关，原文靠底色就找得回来。
      // 再点高亮走的是同一张浮层，不挂伴读脚注，所以不会混进伴读清单，
      // 也不会让伴读以为这章已经标过。
      await recordTranslateResult(
        node.id,
        unitAtStart,
        source,
        [result.translation, result.note].filter(Boolean).join('\n\n'),
      );
      setTranslation({
        x: anchorX,
        yTop: anchorTop,
        yBottom: anchorBottom,
        source,
        status: 'done',
        text: result.translation,
        note: result.note,
      });
    } catch (e) {
      if (translateRunRef.current !== token) return;
      // 伴读是锦上添花，翻译也是：失败说出来，但别往正文上糊东西。
      const reason = e instanceof Error ? e.message : String(e);
      console.error('[Spoor] 划词翻译失败', e);
      // 已经流出来的译文留着：写到一半断掉，读者至少知道自己读到了哪儿，
      // 而不是屏幕一变又退回成空卡片，前面等的那几秒白等了。
      setTranslation((cur) => ({
        x: anchorX,
        yTop: anchorTop,
        yBottom: anchorBottom,
        source,
        status: 'error',
        text: cur?.text ?? '',
        note: t('reference.book_translate_failed', { reason }),
      }));
    }
  }, [aiConfig, askUi, dismissSelectionToolbar, i18n?.language, node.id, sourceLabel, t, unit]);

  // 点浮层外面、按 Esc、重新划选，都收掉它。
  useEffect(() => {
    if (!translation) return;
    const onPointerDown = (e: PointerEvent) => {
      if (translationRef.current?.contains(e.target as Node)) return;
      closeTranslation();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTranslation();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [translation, closeTranslation]);

  // 重新划选意味着读者改主意了，上一条译文留着只会挡路。
  useEffect(() => {
    if (askUi) closeTranslation();
  }, [askUi, closeTranslation]);

  const runExpandSelection = useCallback(() => {
    const quote = askQuoteRef.current;
    if (!quote || !onExpandSelection) return;
    onExpandSelection(quote.text, quote.sourceLabel);
    dismissSelectionToolbar();
  }, [onExpandSelection, dismissSelectionToolbar]);

  if (!book || unitCount === 0) {
    return (
      <div className="w-full h-full bg-white p-5 shadow-lg border-2 border-[#E6E4DF] flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-[#C2410C]" />
          <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
            {t('nodes.book')}
          </span>
        </div>
        <p className="text-sm text-[#8c8a84] font-serif">{t('nodes.book_empty')}</p>
      </div>
    );
  }

  const formatBadge = book.format === 'pdf' ? 'PDF' : 'EPUB';
  const unitText = unit?.text?.trim() || t('nodes.book_page_no_text');
  const hasHeadingBlocks = Boolean(unit?.blocks?.some((b) => b.type === 'heading'));
  // Avoid duplicating the chapter title when body already renders h1–h6.
  const showUnitTitle = Boolean(unit?.title && book.format === 'epub' && !hasHeadingBlocks);
  // 摘抄始终可用（写进这本书的摘抄本，不依赖宿主回调），所以有选区就显示工具栏。
  // 沉浸阅读只留「摘抄」——思维导图和问 AI 在画布的卡片上有，全屏里不必挤三个按钮。
  const showSelectionActions = Boolean(askUi) && !isExpanding;
  /**
   * 页码栏翻页按钮的框：全屏里栏要压到数字那么高，按钮就只留图标那 16px，
   * 用一层 `before` 把可点区域向外撑 8px（点它等于点按钮），手指和鼠标都好按。
   * 画布上的小书卡不受影响，维持原来 28px 的实打实点击区。
   */
  const pageNavButtonClass =
    layout === 'immersive'
      ? "relative p-0 before:absolute before:-inset-2 before:content-['']"
      : 'p-1.5';
  /**
   * 沉浸阅读时工具栏必须挂进全屏容器内部。
   * 默认它挂到 `document.body`，而全屏容器是 `z-[125]` 加不透明背景，
   * 工具栏的 `z-[80]` 会被整个盖住——选中了却看不到按钮。
   * 长文的对话面板用同样的办法（见 `ChatPanel` 的 `portalHost`）。
   */
  const selectionPortalHost =
    layout === 'immersive' && typeof document !== 'undefined'
      ? ((bodyRef.current?.closest('[data-testid="book-fullscreen"]') as HTMLElement | null) ??
        undefined)
      : undefined;

  /**
   * 页码栏。画布上那张小书卡自己留着——它是个独立的小盒子，页码栏属于它；
   * 全屏时借住顶栏（`pageNavHost`）：放底部或正文上方都还占着阅读区的一行，
   * 借上去一像素都不占。这套「外部给个空位、按钮借住」的办法，和对话栏把
   * 「历史 / 新建」借给顶栏是同一个，见 BookFullscreen。
   */
  const pageNavNode = (
      <div
        className={`flex pointer-events-auto items-center justify-between gap-2 shrink-0 ${
          layout === 'immersive'
            ? // 借住的空位给的是**阅读区**的范围（两条抽屉之间），这一栏要在这
              // 范围内再按正文列的宽度收一次：`max-w-3xl` 和正文那列同宽，
              // 两者才对得上。少了它，这一栏会横跨整个空位，justify-between
              // 把两个箭头甩到窗口两端——抽屉一收就看不见了，正好压在书名和
              // 右侧按钮底下。
              'mx-auto w-full max-w-3xl px-6'
            : 'mt-2 pt-2 border-t border-[#E6E4DF]'
        }`}
        data-testid="book-page-nav"
        data-no-drag=""
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={safeIndex <= 0 || isExpanding}
          className={`${pageNavButtonClass} rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 disabled:hover:bg-transparent transition-colors`}
          aria-label={t('nodes.book_prev')}
          onClick={() => goToPage(safeIndex - 1)}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="flex items-center gap-2 text-[11px] font-mono text-[#8c8a84] tabular-nums">
          <span>
            {t('nodes.book_page', { current: safeIndex + 1, total: unitCount })}
            {book.format === 'pdf' ? ` · p.${pageLabel}` : ''}
          </span>
          {layout === 'card' && excerptCount > 0 ? (
            // 摘抄不再往画布加卡，所以在卡片上给一个可见的计数回执。
            <span
              data-testid="book-excerpt-count"
              className="inline-flex items-center gap-1 text-[#C2410C]"
              title={t('reference.book_excerpt_title')}
            >
              <StickyNote className="h-3 w-3" aria-hidden />
              {excerptCount}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          disabled={safeIndex >= unitCount - 1 || isExpanding}
          className={`${pageNavButtonClass} rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 disabled:hover:bg-transparent transition-colors`}
          aria-label={t('nodes.book_next')}
          onClick={() => goToPage(safeIndex + 1)}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
  );

  /**
   * 浮层上的关闭键。抽成变量是因为它有两个位置：单词查词时跟在词后面，
   * 整段翻译时贴在右上角（那一条只挂关闭键的行会把正文顶出一道空带）。
   */
  const closeButton = (
    <button
      type="button"
      data-testid="book-translate-close"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        closeTranslation();
      }}
      title={t('reference.book_translate_close')}
      aria-label={t('reference.book_translate_close')}
      className="shrink-0 rounded p-0.5 text-[#b8b4ac] hover:bg-[#F4F1ED] hover:text-[#C2410C]"
    >
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
  );

  /**
   * 再点高亮时才有的复制和去掉。放在词的那一行或右上角，不跟义项、译文挤在一起。
   * 初次划词没有 markId，这两颗不出现，排版和原来一样。
   */
  const replayActions = translation?.markId ? (
    <>
      <button
        type="button"
        data-testid="book-translate-replay-copy"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={() => {
          const body = [translation.text, translation.note].filter(Boolean).join('\n\n');
          void copyTextToClipboard(`${translation.source}\n\n${body}`.trim())
            .then(() => {
              setReplayCopied(true);
              if (copiedNoteTimerRef.current !== null) {
                window.clearTimeout(copiedNoteTimerRef.current);
              }
              copiedNoteTimerRef.current = window.setTimeout(() => {
                copiedNoteTimerRef.current = null;
                setReplayCopied(false);
              }, 1600);
            })
            .catch(() => undefined);
        }}
        title={t('reference.book_translate_copy')}
        aria-label={t('reference.book_translate_copy')}
        className="shrink-0 rounded p-0.5 text-[#b8b4ac] hover:bg-[#F4F1ED] hover:text-[#C2410C]"
      >
        {replayCopied ? (
          <Check className="h-3.5 w-3.5 text-[#15803d]" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <button
        type="button"
        data-testid="book-translate-replay-delete"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={() => {
          const id = translation.markId;
          if (!id) return;
          // 不传章节号：去掉的是读者自己的高亮，不是在拒绝这一章的伴读。
          void removeBookFocusMarks(node.id, [id]);
          closeTranslation();
        }}
        title={t('reference.book_translate_delete')}
        aria-label={t('reference.book_translate_delete')}
        className="shrink-0 rounded p-0.5 text-[#b8b4ac] hover:bg-[#F4F1ED] hover:text-[#b91c1c]"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={
        layout === 'immersive'
          ? 'w-full h-full min-h-0 bg-transparent flex flex-col'
          : 'w-full h-full bg-white p-4 shadow-lg border-2 border-[#E6E4DF] flex flex-col min-h-[280px]'
      }
      style={layout === 'immersive' ? undefined : { outline: '1px solid transparent' }}
      onDoubleClick={
        layout === 'card' && onOpenFullscreen
          ? (e) => {
              e.stopPropagation();
              onOpenFullscreen(node.id);
            }
          : undefined
      }
    >
      {layout === 'card' ? (
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <BookOpen className="w-4 h-4 text-[#C2410C] shrink-0" />
        <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
          {t('nodes.book')}
        </span>
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F4F1ED] text-[#8c8a84]">
          {formatBadge}
        </span>
        {isExpanding && (
          <span className="flex items-center gap-1 text-[11px] font-sans text-[#C2410C]">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('nodes.book_expanding')}
          </span>
        )}
        <span
          className="text-[11px] font-mono text-[#5a5a54] ml-auto truncate min-w-0"
          title={sourceLabel}
        >
          {book.title || sourceLabel}
        </span>
        {onOpenFullscreen ? (
          <button
            type="button"
            data-testid={`book-open-${node.id}`}
            data-no-drag=""
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenFullscreen(node.id);
            }}
            title={t('nodes.book_open')}
            aria-label={t('nodes.book_open')}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[#C2410C] text-white hover:bg-[#a0350a] transition-colors shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      ) : null}

      <div className="relative flex-1 min-h-0">
        <div
          ref={bodyRef}
          data-testid="book-body"
          data-no-drag=""
          tabIndex={-1}
          // relative：脚注是这个滚动容器里的绝对定位元素，坐标换算要贴着它算。
          className={`relative h-full overflow-y-auto min-h-0 custom-scrollbar font-serif text-[#4a4a44] select-text cursor-text focus:outline-none${
            unit?.blocks?.length ? '' : ' whitespace-pre-wrap'
          } ${
            layout === 'immersive'
              ? 'text-[17px] leading-[1.9] max-w-3xl mx-auto w-full px-6 py-6'
              : 'text-sm leading-relaxed pr-1'
          }`}
          {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onBodyClick}
          onPointerMove={onBodyPointerMove}
          onPointerLeave={onBodyPointerLeave}
          onMouseUp={updateSelectionAsk}
          onScroll={(e) => {
            persistScrollTop(e.currentTarget.scrollTop);
            prunePassageHighlightOnScroll();
          }}
        >
          {showUnitTitle && (
            <div className="text-[11px] font-sans font-semibold text-[#8c8a84] mb-2 tracking-wide">
              {unit?.title}
            </div>
          )}
          <BookUnitBody blocks={unit?.blocks} fallbackText={unitText} />
        </div>

        {translation
          ? createPortal(
              <div
                ref={translationRef}
                data-testid="book-translate-popover"
                data-no-drag=""
                data-canvas-overlay=""
                role="status"
                aria-live="polite"
                style={{
                  // 挂在选区正下方、以选区中心对齐；下方放不下就翻到选区上方，
                  // 免得浮层被窗口下沿裁掉。贴边时 shiftX / shiftY 往回拉。
                  top: translationAbove ? translation.yTop : translation.yBottom,
                  left: translation.x,
                  transform: `translate(calc(-50% + ${translationShift}px), ${
                    translationAbove ? 'calc(-100% - 10px)' : '10px'
                  })`,
                }}
                className="fixed z-[85] w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-[#E6E4DF] bg-white/98 p-3 shadow-lg shadow-black/5 backdrop-blur-md"
              >
                {/*
                  单词查词才摆出那个词——摆上既填住了，也顺手回答"我查的是哪个"。

                  整段翻译时**整行都不渲染**：留着一条只挂关闭键的空行，正文上方就是
                  一道白晃晃的带子，长句翻出来两行字时尤其明显。关闭键改为贴角，
                  正文让出右边一截免得压到字。
                */}
                {translation.word ? (
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-serif text-[13px] font-semibold text-[#2c2c28]">
                      {translation.word}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      {replayActions}
                      {closeButton}
                    </span>
                  </div>
                ) : (
                  <div className="absolute right-2 top-2 flex items-center gap-0.5">
                    {replayActions}
                    {closeButton}
                  </div>
                )}
                <div className={translation.word ? undefined : translation.markId ? 'pr-[4.5rem]' : 'pr-7'}>
                {translation.status === 'loading' && !translation.text ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-[#5a5a54]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {t('reference.book_translate_loading')}
                  </p>
                ) : (
                  <>
                    {translation.phonetic ? (
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span className="font-mono text-[12px] text-[#8c8a84]">
                          /{translation.phonetic}/
                        </span>
                        <button
                          type="button"
                          data-testid="book-translate-speak"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          onClick={() =>
                            speakWord(
                              translation.word ?? translation.source,
                              translation.english?.find((d) => d.audio)?.audio,
                            )
                          }
                          title={t('reference.book_translate_speak')}
                          aria-label={t('reference.book_translate_speak')}
                          className="rounded p-0.5 text-[#b8b4ac] hover:bg-[#F4F1ED] hover:text-[#C2410C]"
                        >
                          <Volume2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    ) : null}
                    {/* 义项分行：ECDICT 一个词常有好几个义项，挤成一行读者
                        分不清"系统"和"制度"是两个说法。 */}
                    {translation.text.split('\n').map((line, i) => (
                      <p
                        key={i}
                        className="text-[13px] leading-relaxed text-[#2c2c28]"
                      >
                        {line}
                      </p>
                    ))}
                    {/* 流式进行中：末尾一根细条。译文在长这件事要看得见，
                        否则读者分不清"模型还在写"和"卡住了不动"。 */}
                    {translation.status === 'loading' ? (
                      <span
                        data-testid="book-translate-caret"
                        aria-hidden
                        className="mt-0.5 inline-block h-3 w-[2px] animate-pulse bg-[#C2410C]"
                      />
                    ) : null}
                    {translation.english?.length ? (
                      <div className="mt-2 border-t border-[#EFEDE8] pt-2">
                        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#a8a49c]">
                          {t('reference.book_translate_english_label')}
                          {translation.englishSource ? (
                            <span className="ml-1.5 font-normal normal-case tracking-normal">
                              · {translation.englishSource}
                            </span>
                          ) : null}
                        </p>
                        {translation.english.map((def, i) => (
                          <p
                            key={i}
                            className="text-[12px] leading-relaxed text-[#5a5a54]"
                          >
                            {def.pos ? (
                              <span className="mr-1 font-mono text-[10.5px] italic text-[#a8a49c]">
                                {def.pos}
                              </span>
                            ) : null}
                            {def.text}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {translation.note ? (
                      <p className="mt-1.5 border-t border-[#EFEDE8] pt-1.5 text-[11.5px] leading-relaxed text-[#8c8a84]">
                        <span className="font-semibold">
                          {t('reference.book_translate_note_label')}
                        </span>
                        {translation.note}
                      </p>
                    ) : null}
                  </>
                )}
                </div>
              </div>,
              selectionPortalHost ?? document.body,
            )
          : null}
        {showSelectionActions && askUi && (
          <TextSelectionToolbar
            top={askUi.top}
            left={askUi.left}
            toolbarRef={askToolbarRef}
            onArm={armSelectionToolbar}
            onDisarm={disarmSelectionToolbar}
            placement={layout === 'immersive' ? 'fixed' : 'absolute'}
            portalHost={selectionPortalHost}
          >
            <TextSelectionToolbarButton
              variant="primary"
              onArm={armSelectionToolbar}
              onAction={runExtractSelection}
            >
              <StickyNote className="w-3 h-3" />
              {t('nodes.book_to_card')}
            </TextSelectionToolbarButton>
            {aiConfig ? (
              /* 没配模型就不露这颗：点下去必然失败的动作，不如没有。 */
              <TextSelectionToolbarButton
                variant="ghost"
                onArm={armSelectionToolbar}
                onAction={() => void runTranslateSelection()}
              >
                <Languages className="w-3 h-3" />
                {t('reference.book_translate')}
              </TextSelectionToolbarButton>
            ) : null}
            {layout === 'card' && onExpandSelection && (
              <TextSelectionToolbarButton
                variant="ghost"
                onArm={armSelectionToolbar}
                onAction={runExpandSelection}
              >
                <GitBranch className="w-3 h-3" />
                {t('nodes.book_expand')}
              </TextSelectionToolbarButton>
            )}
            {layout === 'card' && onAskAboutSelection && (
              <TextSelectionToolbarButton
                variant="ghost"
                onArm={armSelectionToolbar}
                onAction={runAskAboutSelection}
              >
                <Wand2 className="w-3 h-3" />
                {t('nodes.book_ask_ai')}
              </TextSelectionToolbarButton>
            )}
          </TextSelectionToolbar>
        )}

      </div>


      {layout === 'immersive' && pageNavHost
        ? createPortal(pageNavNode, pageNavHost)
        : pageNavNode}
    </div>
  );
}
