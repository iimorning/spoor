import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronLeft, ChevronRight, GitBranch, Loader2, Maximize2, StickyNote, Wand2 } from 'lucide-react';
import { db } from '../../db';
import type { BookNodeProps } from './types';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import type { BookContentBlock } from '../../utils/bookPayload';
import { tryParseBookContent } from '../../utils/bookPayload';
import {
  BOOK_READER_PAGE_LOCK_MS,
  BOOK_READER_SCROLL_END_SENTINEL,
  bookChapterFlipFromWheel,
  nextBookReaderScrollTop,
} from '../../utils/bookReaderScroll';
import { useTextSelectionToolbar } from '../../hooks/useTextSelectionToolbar';
import { TextSelectionToolbar, TextSelectionToolbarButton } from '../TextSelectionToolbar';

function clampPageIndex(index: number, unitCount: number): number {
  if (unitCount <= 0) return 0;
  return Math.min(Math.max(0, index), unitCount - 1);
}

const HEADING_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'text-[1.35rem] font-bold tracking-wide text-[#2a2a26] leading-snug mt-1 mb-3 first:mt-0',
  2: 'text-[1.15rem] font-bold text-[#2a2a26] leading-snug mt-4 mb-2 first:mt-0',
  3: 'text-base font-semibold text-[#2a2a26] leading-snug mt-3 mb-2 first:mt-0',
  4: 'text-[0.95rem] font-semibold text-[#3a3a34] leading-snug mt-3 mb-1.5 first:mt-0',
  5: 'text-sm font-semibold text-[#3a3a34] leading-snug mt-2 mb-1 first:mt-0',
  6: 'text-sm font-medium text-[#4a4a44] leading-snug mt-2 mb-1 first:mt-0',
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
  onExtractSelectionToCard,
  onAskAboutSelection,
  onExpandSelection,
  isExpanding = false,
  onOpenFullscreen,
  layout = 'card',
}: BookNodeProps) {
  const { t } = useTranslation();
  const book = useMemo(() => tryParseBookContent(node.content), [node.content]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreScrollPersistRef = useRef(false);
  const pageScrollLockUntilRef = useRef(0);

  const unitCount = book?.units.length ?? 0;
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
    clampSelector: layout === 'immersive' ? '[data-testid="book-fullscreen"]' : undefined,
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

    const stepPage = (direction: 1 | -1, now: number) => {
      const nextTop = nextBookReaderScrollTop({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        direction,
      });
      const canScrollFurther = Math.abs(nextTop - el.scrollTop) > 0.5;

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

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKeyDown);
    };
    // unitCount: bodyRef only mounts once parsed book units exist.
  }, [node.id, unitCount]);

  const runExtractSelectionToCard = useCallback(() => {
    const quote = askQuoteRef.current;
    if (!quote || !onExtractSelectionToCard) return;
    onExtractSelectionToCard(quote.text, quote.sourceLabel, node.id);
    dismissSelectionToolbar();
  }, [onExtractSelectionToCard, dismissSelectionToolbar, node.id]);

  const runAskAboutSelection = useCallback(() => {
    const quote = askQuoteRef.current;
    if (!quote || !onAskAboutSelection) return;
    onAskAboutSelection(quote.text, quote.sourceLabel, node.id);
    dismissSelectionToolbar();
  }, [onAskAboutSelection, dismissSelectionToolbar, node.id]);

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
          <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
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
  const showSelectionActions =
    askUi &&
    (onExtractSelectionToCard || onAskAboutSelection || onExpandSelection) &&
    !isExpanding;

  return (
    <div
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
        <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
          {t('nodes.book')}
        </span>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#F4F1ED] text-[#8c8a84]">
          {formatBadge}
        </span>
        {isExpanding && (
          <span className="flex items-center gap-1 text-[10px] font-sans text-[#C2410C]">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('nodes.book_expanding')}
          </span>
        )}
        <span
          className="text-[10px] font-mono text-[#5a5a54] ml-auto truncate min-w-0"
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
          data-no-drag=""
          tabIndex={-1}
          className={`h-full overflow-y-auto min-h-0 custom-scrollbar font-serif text-[#4a4a44] select-text cursor-text focus:outline-none${
            unit?.blocks?.length ? '' : ' whitespace-pre-wrap'
          } ${
            layout === 'immersive'
              ? 'text-lg leading-[1.9] max-w-3xl mx-auto w-full px-6 py-6'
              : 'text-sm leading-relaxed pr-1'
          }`}
          {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseUp={updateSelectionAsk}
          onScroll={(e) => persistScrollTop(e.currentTarget.scrollTop)}
        >
          {showUnitTitle && (
            <div className="text-[11px] font-sans font-semibold text-[#8c8a84] mb-2 tracking-wide">
              {unit?.title}
            </div>
          )}
          <BookUnitBody blocks={unit?.blocks} fallbackText={unitText} />
        </div>

        {showSelectionActions && askUi && (
          <TextSelectionToolbar
            top={askUi.top}
            left={askUi.left}
            toolbarRef={askToolbarRef}
            onArm={armSelectionToolbar}
            onDisarm={disarmSelectionToolbar}
            placement={layout === 'immersive' ? 'fixed' : 'absolute'}
          >
            {onExtractSelectionToCard && (
              <TextSelectionToolbarButton
                variant="primary"
                onArm={armSelectionToolbar}
                onAction={runExtractSelectionToCard}
              >
                <StickyNote className="w-3 h-3" />
                {t('nodes.book_to_card')}
              </TextSelectionToolbarButton>
            )}
            {onExpandSelection && (
              <TextSelectionToolbarButton
                variant="ghost"
                onArm={armSelectionToolbar}
                onAction={runExpandSelection}
              >
                <GitBranch className="w-3 h-3" />
                {t('nodes.book_expand')}
              </TextSelectionToolbarButton>
            )}
            {onAskAboutSelection && (
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

      <div
        className={`flex items-center justify-between gap-2 shrink-0 ${
          layout === 'immersive'
            ? 'mt-0 px-6 py-3 border-t border-[#E6E4DF] bg-white/90'
            : 'mt-2 pt-2 border-t border-[#E6E4DF]'
        }`}
        data-no-drag=""
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={safeIndex <= 0 || isExpanding}
          className="p-1.5 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label={t('nodes.book_prev')}
          onClick={() => goToPage(safeIndex - 1)}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-mono text-[#8c8a84] tabular-nums">
          {t('nodes.book_page', { current: safeIndex + 1, total: unitCount })}
          {book.format === 'pdf' ? ` · p.${pageLabel}` : ''}
        </span>
        <button
          type="button"
          disabled={safeIndex >= unitCount - 1 || isExpanding}
          className="p-1.5 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label={t('nodes.book_next')}
          onClick={() => goToPage(safeIndex + 1)}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
