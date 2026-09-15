import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from '../../../db';
import type { CanvasNode } from '../../../db';
import { isContentBlurPersistenceDisabled } from '../../../config/persistence';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../../utils/canvasNodeContextText';
import { canvasEditLockProps } from '../../../utils/canvasOverlay';
import { pastePlainText } from '../../../utils/pastePlainText';
import { placeCaretAtOffset, textOffsetFromPoint } from '../../../utils/placeCaretAtEnd';
import { noteContentForEditor } from '../../../utils/noteContentForEditor';
import { NOTE_CARD_SCROLL_MAX_HEIGHT_PX } from '../../../utils/canvas';

export interface NoteBodyProps {
  node: CanvasNode;
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
  editClassName: string;
  viewClassName: string;
  emptyNotePlaceholder: string;
  scrollAreaClassName?: string;
  /** View-mode text (e.g. body without a trailing source URL). Edit still uses `node.content`. */
  viewText?: string;
}

/**
 * Ordinary notes are plain text in both view and edit (pre-wrap).
 * Markdown stays on AI / essay cards — mixing it here made preview and the
 * editor diverge (HTML islands, remark-breaks vs textContent).
 */
export function NoteBody({
  node,
  editingNodeId,
  setEditingNodeId,
  editClassName,
  viewClassName,
  emptyNotePlaceholder,
  scrollAreaClassName = 'flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar',
  viewText,
}: NoteBodyProps) {
  const isEditing = editingNodeId === node.id;
  const editRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seededForEditRef = useRef(false);
  const savedScrollTopRef = useRef(0);
  const pendingCaretOffsetRef = useRef<number | null>(null);

  /** 乐观值：blur 写库后立刻显示，避开 liveQuery 异步刷新的空档闪烁 */
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const blurBaselineRef = useRef<string | null>(null);

  const storedText = noteContentForEditor(pendingContent ?? node.content);
  const visibleText = isEditing
    ? storedText
    : noteContentForEditor(viewText ?? pendingContent ?? node.content);
  const userSizedHeight = Boolean(node.height && node.height > 0);

  const captureScroll = () => {
    if (scrollRef.current) savedScrollTopRef.current = scrollRef.current.scrollTop;
  };

  const restoreScroll = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTopRef.current;
  };

  useEffect(() => {
    if (pendingContent === null) return;
    if (node.content === pendingContent) {
      setPendingContent(null);
      blurBaselineRef.current = null;
      return;
    }
    const baseline = blurBaselineRef.current;
    if (baseline !== null && node.content !== baseline && node.content !== pendingContent) {
      setPendingContent(null);
      blurBaselineRef.current = null;
    }
  }, [node.content, pendingContent]);

  useLayoutEffect(() => {
    if (!isEditing) {
      seededForEditRef.current = false;
      restoreScroll();
      return;
    }
    if (seededForEditRef.current) return;
    const el = editRef.current;
    if (!el) return;
    el.textContent = visibleText;
    seededForEditRef.current = true;
    const offset = pendingCaretOffsetRef.current;
    pendingCaretOffsetRef.current = null;
    if (offset != null) {
      placeCaretAtOffset(el, offset);
    } else {
      el.focus({ preventScroll: true });
    }
    restoreScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed from visible text at edit-enter only
  }, [isEditing, node.id]);

  return (
    <div
      ref={scrollRef}
      data-testid="note-body-scroll"
      className={scrollAreaClassName}
      style={userSizedHeight ? undefined : { maxHeight: NOTE_CARD_SCROLL_MAX_HEIGHT_PX }}
      {...canvasEditLockProps(isEditing)}
      {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
    >
      {isEditing ? (
        <div
          key="note-edit"
          ref={editRef}
          className={editClassName}
          contentEditable
          suppressContentEditableWarning
          style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--note-cjk-stack)' }}
          onPaste={pastePlainText}
          onBlur={(e) => {
            captureScroll();
            const next = e.currentTarget.innerText ?? e.currentTarget.textContent ?? '';
            if (!isContentBlurPersistenceDisabled()) {
              blurBaselineRef.current = node.content ?? '';
              void db.nodes.update(node.id, { content: next });
              setPendingContent(next);
            }
            setEditingNodeId(null);
          }}
        />
      ) : (
        <div
          key="note-view"
          data-testid="markdown"
          onClick={(e) => {
            captureScroll();
            pendingCaretOffsetRef.current = textOffsetFromPoint(e.currentTarget, e.clientX, e.clientY);
            setEditingNodeId(node.id);
          }}
          className={`cursor-text min-h-[50px] ${viewClassName}`}
          style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--note-cjk-stack)' }}
        >
          {visibleText || <span className="text-gray-300">{emptyNotePlaceholder}</span>}
        </div>
      )}
    </div>
  );
}
