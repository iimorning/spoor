import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  computeTextSelectionToolbarPos,
  computeTextSelectionToolbarPosViewport,
  type TextSelectionToolbarPos,
} from '../utils/textSelectionToolbarPos';
import { sliceSourceMarkdownFromSelection } from '../utils/sliceSourceMarkdownFromSelection';

export type { TextSelectionToolbarPos };

export type TextSelectionQuote = {
  text: string;
  sourceLabel: string;
  markdown?: string;
};

export function useTextSelectionToolbar(options: {
  bodyRef: RefObject<HTMLElement | null>;
  sourceLabel: string;
  disabled?: boolean;
  toolbarWidth?: number;
  toolbarHeight?: number;
  /** Original markdown of the body; used to keep tables/headings when extracting. */
  sourceMarkdown?: string;
  /**
   * `local` (default): absolute coords inside a canvas card (zoom-aware).
   * `viewport`: `position: fixed` coords next to the selection (chat overlay).
   */
  positionMode?: 'local' | 'viewport';
  /** Used with `viewport` to keep the toolbar inside a panel. */
  clampSelector?: string;
}) {
  const {
    bodyRef,
    sourceLabel,
    disabled = false,
    toolbarWidth = 188,
    toolbarHeight = 40,
    sourceMarkdown,
    positionMode = 'local',
    clampSelector,
  } = options;
  const [askUi, setAskUi] = useState<TextSelectionToolbarPos | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const armedRef = useRef(false);
  const quoteRef = useRef<TextSelectionQuote | null>(null);
  const sourceLabelRef = useRef(sourceLabel);
  sourceLabelRef.current = sourceLabel;
  const sourceMarkdownRef = useRef(sourceMarkdown);
  sourceMarkdownRef.current = sourceMarkdown;

  useEffect(() => {
    if (disabled) setAskUi(null);
  }, [disabled]);

  const clearAskUi = useCallback(() => setAskUi(null), []);

  const updateSelectionAsk = useCallback(() => {
    if (disabled) {
      setAskUi(null);
      return;
    }
    // Keep the action bar mounted while interacting with it.
    if (armedRef.current || toolbarRef.current?.matches(':hover')) {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !bodyRef.current) {
      setAskUi(null);
      return;
    }
    if (!bodyRef.current.contains(sel.anchorNode) || !bodyRef.current.contains(sel.focusNode)) {
      setAskUi(null);
      return;
    }
    const visible = sel.toString();
    const text = visible.replace(/\s+/g, ' ').trim();
    if (text.length < 2) {
      setAskUi(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const { top, left } =
      positionMode === 'viewport'
        ? computeTextSelectionToolbarPosViewport({
            range,
            toolbarWidth,
            toolbarHeight,
            clamp: (
              (clampSelector
                ? bodyRef.current.closest(clampSelector)
                : null) ?? document.documentElement
            ).getBoundingClientRect(),
          })
        : computeTextSelectionToolbarPos({
            range,
            positionParent: bodyRef.current.parentElement ?? bodyRef.current,
            toolbarWidth,
            toolbarHeight,
          });
    setAskUi({ text, top, left });
    const markdown = sourceMarkdownRef.current
      ? sliceSourceMarkdownFromSelection(sourceMarkdownRef.current, visible)
      : undefined;
    quoteRef.current = {
      text,
      sourceLabel: sourceLabelRef.current,
      markdown: markdown || undefined,
    };
  }, [bodyRef, clampSelector, disabled, positionMode, toolbarHeight, toolbarWidth]);

  const dismissSelectionToolbar = useCallback(() => {
    armedRef.current = false;
    quoteRef.current = null;
    clearAskUi();
    window.getSelection()?.removeAllRanges();
  }, [clearAskUi]);

  const arm = useCallback(() => {
    armedRef.current = true;
  }, []);

  const disarm = useCallback(() => {
    armedRef.current = false;
  }, []);

  useEffect(() => {
    const onSelChange = () => {
      requestAnimationFrame(updateSelectionAsk);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, [updateSelectionAsk]);

  return {
    askUi,
    toolbarRef,
    quoteRef,
    updateSelectionAsk,
    dismissSelectionToolbar,
    clearAskUi,
    arm,
    disarm,
  };
}
