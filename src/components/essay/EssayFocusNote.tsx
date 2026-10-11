import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Copy, X } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import type { EssayFocusMark } from '../../db';
import { findQuoteRange } from '../../utils/essayQuoteRange';
import { copyTextToClipboard } from '../../utils/copyTextToClipboard';

const GAP = 8;
const EDGE = 8;

/**
 * 点开某条标注后浮在正文上方的小卡片。
 *
 * 位置挂在**被标注那句话自己的坐标**上，不是选区上——点标注时 ProseMirror 会把光标
 * 挪进那一行，而用户完全可能点完之后把光标移到别处继续写。用选区定位的话，卡片会在
 * 用户下一次移动光标时跑掉。
 */
export function EssayFocusNote({
  editor,
  mark,
  onDelete,
  onClose,
}: {
  editor: Editor | null;
  mark: EssayFocusMark;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    if (!editor) return;
    const range = findQuoteRange(editor.state.doc, mark.quote);
    if (!range) return;
    let coords;
    try {
      coords = editor.view.coordsAtPos(range.from);
    } catch {
      return;
    }
    const panel = panelRef.current;
    const width = panel?.offsetWidth ?? 320;
    // 贴到右缘就往左收，别让卡片有一半在屏幕外。
    const left = Math.max(EDGE, Math.min(coords.left, window.innerWidth - width - EDGE));
    // 下面放不下就翻到上面去。
    const below = coords.bottom + GAP;
    const top =
      below + (panel?.offsetHeight ?? 120) > window.innerHeight - EDGE
        ? Math.max(EDGE, coords.top - GAP - (panel?.offsetHeight ?? 120))
        : below;
    setPos({ top, left });
  }, [editor, mark.quote]);

  useLayoutEffect(place, [place]);

  useEffect(() => {
    if (!pos) return;
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [place, pos]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const onCopy = async () => {
    try {
      await copyTextToClipboard(`${mark.quote}\n\n${mark.note}`);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板被拒时不给假成功：图标不变就是没复制成。
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      data-testid="essay-focus-note"
      role="dialog"
      aria-label={t('reference.essay_focus_note_title')}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[132] w-[min(26rem,92vw)] rounded-lg border border-[#E6E4DF] bg-[#fffdf5] p-3 pr-9 font-sans text-[#2c2c28] shadow-lg"
    >
      <button
        type="button"
        data-testid="essay-focus-note-delete"
        onClick={() => onDelete(mark.id)}
        title={t('reference.essay_focus_delete')}
        aria-label={t('reference.essay_focus_delete')}
        className="absolute right-2 top-2 text-[#8a8a82] transition-colors hover:text-[#C2410C]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <p className="text-[12.5px] leading-relaxed">
        {mark.note}
        {/* 复制图标跟在正文末尾，不另起一行——批注大多只有两三行，
            为一个按钮空出整行太奢侈了。 */}
        <button
          type="button"
          data-testid="essay-focus-note-copy"
          onClick={() => void onCopy()}
          title={t('reference.essay_focus_copy')}
          aria-label={t('reference.essay_focus_copy')}
          className="ml-1 inline-flex h-4 w-4 -translate-y-px items-center justify-center rounded align-baseline text-[#8a8a82] transition-colors hover:text-[#C2410C]"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
        {copied ? (
          <span className="ml-1 align-baseline text-[11px] text-[#8a8a82]">
            {t('reference.essay_focus_copied')}
          </span>
        ) : null}
      </p>
    </div>,
    document.body,
  );
}
