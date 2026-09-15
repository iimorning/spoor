import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';

/**
 * Adopt / Remove popover for AI suggestion marks (inserted transitions or
 * proposed deletions).
 *
 * Positioning: fixed, anchored above (or below if no headroom) the mark's
 * bounding rect. Recomputes on layout-affecting changes. Hides on window scroll
 * or resize via the `onClose` callback.
 *
 * Closes on outside click or Escape.
 * Insert: Adopt unsets the mark; Remove deletes the range.
 * Delete: Adopt deletes the range; Remove unsets the mark (keeps original text).
 */
export interface AiTransitionPopoverProps {
  editor: Editor;
  range: { from: number; to: number };
  kind?: 'insert' | 'delete';
  onAdopt: (text: string) => void;
  onRemove: (text: string) => void;
  onClose: () => void;
}

export function AiTransitionPopover({
  editor,
  range,
  kind = 'insert',
  onAdopt,
  onRemove,
  onClose,
}: AiTransitionPopoverProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'below' | 'above' } | null>(
    null,
  );

  // The transition text — for callback payload and label. textBetween ignores
  // inline formatting, which is fine for both purposes.
  const text = React.useMemo(() => {
    try {
      return editor.state.doc.textBetween(range.from, range.to, '\n', '\n');
    } catch {
      return '';
    }
  }, [editor, range.from, range.to]);

  // Compute position from the mark's DOM rect. Find the mark ancestor of the
  // range's `from` position; use its bounding rect. Flip above if no headroom.
  useLayoutEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      try {
        const view = editor.view;
        // Resolve the DOM node for the range's `from` position and walk up to
        // find the wrapping <mark data-ai-transition>. nodeDOM may return a
        // Text node (when the position falls inside text content), so we walk
        // via parentNode rather than parentElement.
        let node: Node | null = view.nodeDOM(range.from);
        let markEl: HTMLElement | null = null;
        while (node) {
          if (node instanceof HTMLElement && (node.dataset.aiTransition !== undefined || node.dataset.aiDeletion !== undefined)) {
            markEl = node;
            break;
          }
          node = node.parentNode;
        }
        if (!markEl) {
          setPosition(null);
          return;
        }
        const rect = markEl.getBoundingClientRect();
        const popoverHeight = 40; // approximate; the actual height is known after render
        const placeBelow =
          rect.bottom + popoverHeight + 12 <= window.innerHeight || rect.top - popoverHeight - 12 < 0;
        setPosition({
          top: placeBelow ? rect.bottom + 6 : rect.top - popoverHeight - 6,
          left: rect.left,
          placement: placeBelow ? 'below' : 'above',
        });
      } catch {
        setPosition(null);
      }
    };
    compute();
    raf = window.requestAnimationFrame(compute);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [editor, range.from, range.to]);

  // Hide on window scroll/resize — recomputing every frame is overkill and the
  // popover is small enough that the user will re-hover the mark to see it again.
  useEffect(() => {
    const hide = () => onClose();
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [onClose]);

  // Outside click + Escape — capture phase, defer listener attach by a tick so
  // the click that opened the popover doesn't immediately close it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const popoverEl = popoverRef.current;
      if (popoverEl && popoverEl.contains(e.target as Node)) return;
      const editorEl = editor.view.dom;
      if (editorEl.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
    }, 0);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [editor, onClose]);

  const handleAdopt = () => {
    if (kind === 'delete') {
      editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
    } else {
      editor
        .chain()
        .focus()
        .setTextSelection({ from: range.from, to: range.to })
        .unsetMark('aiTransition')
        .run();
    }
    onAdopt(text);
    onClose();
  };

  const handleRemove = () => {
    if (kind === 'delete') {
      editor
        .chain()
        .focus()
        .setTextSelection({ from: range.from, to: range.to })
        .unsetMark('aiDeletion')
        .run();
    } else {
      editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
    }
    onRemove(text);
    onClose();
  };

  if (!position) return null;

  return (
    <div
      ref={popoverRef}
      data-ai-transition-popover
      role="dialog"
      aria-label={
        kind === 'delete'
          ? t('reference.editor_deletion_label')
          : t('reference.editor_transition_label')
      }
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 30,
      }}
      className="flex items-center gap-1 rounded-md border border-[#E6E4DF] bg-white px-2 py-1 shadow-lg"
    >
      <button
        type="button"
        title={
          kind === 'delete'
            ? t('reference.editor_deletion_hint')
            : t('reference.editor_transition_hint')
        }
        aria-label={
          kind === 'delete' ? t('reference.editor_accept_deletion') : t('reference.editor_adopt')
        }
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleAdopt}
        className="rounded px-2 py-0.5 text-sm font-medium text-[#C2410C] hover:bg-[#FFF7ED]"
      >
        {kind === 'delete' ? t('reference.editor_accept_deletion') : t('reference.editor_adopt')}
      </button>
      <span className="h-4 w-px bg-[#E6E4DF]" aria-hidden />
      <button
        type="button"
        title={
          kind === 'delete'
            ? t('reference.editor_deletion_hint')
            : t('reference.editor_transition_hint')
        }
        aria-label={
          kind === 'delete' ? t('reference.editor_reject_deletion') : t('reference.editor_remove')
        }
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleRemove}
        className="rounded px-2 py-0.5 text-sm font-medium text-[#5a5a54] hover:bg-[#EAE7E2]"
      >
        {kind === 'delete' ? t('reference.editor_reject_deletion') : t('reference.editor_remove')}
      </button>
    </div>
  );
}
