import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { FileText, X } from 'lucide-react';
import type { CanvasNode } from '../../db';
import { chatFocusChipFromNode } from '../../utils/chatFocusChip';
import {
  composerHasContent,
  insertCardAtTextOffset,
  normalizeComposerSegments,
  removeCardFromComposer,
  reorderComposerSegment,
  resolveReorderIndex,
  updateTextSegment,
  type ComposerSegment,
} from '../../utils/chatComposer';
import { filesFromDataTransfer } from '../../utils/chatPanelFileUpload';
import { placeCaretAtOffset } from '../../utils/placeCaretAtEnd';

type DropHint = {
  index: number;
  place: 'before' | 'after' | 'split';
  offset?: number;
  x: number;
  y: number;
  height: number;
};

type Props = {
  segments: ComposerSegment[];
  onSegmentsChange: (segments: ComposerSegment[]) => void;
  nodes: CanvasNode[];
  disabled?: boolean;
  placeholder: string;
  chipFallback: string;
  clearLabel: string;
  onSubmit: () => void;
  onPasteFiles?: (files: File[]) => void;
  onRemoveFocus?: (nodeId: string) => void;
  onBlurPersist?: () => void;
};

export function ComposerInlineInput({
  segments,
  onSegmentsChange,
  nodes,
  disabled = false,
  placeholder,
  chipFallback,
  clearLabel,
  onSubmit,
  onPasteFiles,
  onRemoveFocus,
  onBlurPersist,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; title: string; thumbnailSrc?: string } | null>(null);
  const list = normalizeComposerSegments(segments);
  const showPlaceholder = !composerHasContent(list);

  const listRef = useRef(list);
  listRef.current = list;
  const pendingCaretRef = useRef<{ key: string; offset: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    pendingCaretRef.current = null;
    const host = hostRef.current;
    if (!host) return;
    const el = [...host.querySelectorAll<HTMLElement>('[data-text-key]')].find(
      (node) => node.dataset.textKey === pending.key,
    );
    if (!el) return;
    placeCaretAtOffset(el, pending.offset);
  }, [list]);

  const removeAdjacentCard = (textIndex: number, side: 'before' | 'after') => {
    const current = listRef.current;
    let cardIndex = -1;
    if (side === 'before') {
      for (let i = textIndex - 1; i >= 0; i -= 1) {
        const seg = current[i];
        if (seg?.type === 'card') {
          cardIndex = i;
          break;
        }
        if (seg?.type === 'text' && seg.content) return false;
      }
    } else {
      for (let i = textIndex + 1; i < current.length; i += 1) {
        const seg = current[i];
        if (seg?.type === 'card') {
          cardIndex = i;
          break;
        }
        if (seg?.type === 'text' && seg.content) return false;
      }
    }
    const card = current[cardIndex];
    if (!card || card.type !== 'card') return false;
    const leftCard = [...current.slice(0, cardIndex)]
      .reverse()
      .find((seg): seg is Extract<ComposerSegment, { type: 'card' }> => seg.type === 'card');
    const rightCard = current
      .slice(cardIndex + 1)
      .find((seg): seg is Extract<ComposerSegment, { type: 'card' }> => seg.type === 'card');
    const leftText = current[cardIndex - 1];
    pendingCaretRef.current = {
      key: `text-${leftCard?.nodeId ?? 'start'}-${rightCard?.nodeId ?? 'end'}`,
      offset: leftText?.type === 'text' ? leftText.content.length : 0,
    };
    onSegmentsChange(removeCardFromComposer(current, card.nodeId));
    onRemoveFocus?.(card.nodeId);
    return true;
  };

  const beginChipDrag = (fromIndex: number, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort; window listeners still work */
    }
    setDraggingIndex(fromIndex);
    const dragged = listRef.current[fromIndex];
    const draggedNode =
      dragged?.type === 'card' ? nodes.find((n) => n.id === dragged.nodeId) : undefined;
    const draggedChip = draggedNode
      ? chatFocusChipFromNode(draggedNode, chipFallback)
      : { title: chipFallback, thumbnailSrc: undefined };
    let hint: DropHint | null = null;
    let armed = false;
    const originX = event.clientX;
    const originY = event.clientY;

    const onMove = (move: PointerEvent) => {
      if (!armed) {
        const dx = move.clientX - originX;
        const dy = move.clientY - originY;
        if (dx * dx + dy * dy < 16) return;
        armed = true;
      }
      setGhost({
        x: move.clientX,
        y: move.clientY,
        title: draggedChip.title,
        thumbnailSrc: draggedChip.thumbnailSrc,
      });
      const host = hostRef.current;
      if (!host) return;
      const nextHint = resolveDropHint(host, move.clientX, move.clientY, fromIndex);
      if (!nextHint) return;
      hint = nextHint;
      setDropHint(nextHint);
    };

    const finish = () => {
      try {
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDraggingIndex(null);
      setDropHint(null);
      setGhost(null);
      if (!armed || !hint) return;
      if (hint.place === 'split' && hint.offset != null) {
        onSegmentsChange(insertCardAtTextOffset(listRef.current, fromIndex, hint.index, hint.offset));
        return;
      }
      const target = resolveReorderIndex(fromIndex, hint.index, hint.place);
      if (target === fromIndex) return;
      onSegmentsChange(reorderComposerSegment(listRef.current, fromIndex, target));
    };

    const onUp = () => finish();

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      ref={hostRef}
      data-testid="composer-segments"
      className="relative min-h-[2.75rem] w-full cursor-text text-[15px] leading-7 tracking-[0.02em] text-[#2c2c28]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const last = e.currentTarget.querySelector('[data-testid="canvas-chat-input"]') as HTMLElement | null;
        last?.focus();
      }}
      onPaste={(e) => {
        if (!onPasteFiles) return;
        const files = filesFromDataTransfer(e.clipboardData);
        if (files.length === 0) return;
        e.preventDefault();
        onPasteFiles(files);
      }}
    >
      {showPlaceholder ? (
        <span className="pointer-events-none absolute left-0.5 top-0 text-[15px] leading-7 text-[#aaa]">
          {placeholder}
        </span>
      ) : null}
      {list.map((segment, index) => {
        const isLast = index === list.length - 1;
        if (segment.type === 'card') {
          const node = nodes.find((n) => n.id === segment.nodeId);
          const chip = node
            ? chatFocusChipFromNode(node, chipFallback)
            : { id: segment.nodeId, title: chipFallback };
          return (
            <span
              key={`card-${segment.nodeId}`}
              data-composer-chip=""
              data-segment-index={index}
              data-testid="chat-focus-chip"
              className={`relative z-[1] mx-0.5 inline-flex min-w-0 max-w-[9.5rem] cursor-grab touch-none select-none items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-[#E6E4DF] bg-[#FAF9F6] py-px pl-0.5 pr-1 align-middle text-[11px] leading-4 active:cursor-grabbing ${
                draggingIndex === index ? 'pointer-events-none opacity-35' : ''
              }`}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                beginChipDrag(index, e);
              }}
            >
              {chip.thumbnailSrc ? (
                <img
                  src={chip.thumbnailSrc}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#EFEDE8] text-[#8a8a82]">
                  <FileText className="h-2.5 w-2.5" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap tracking-[0.02em]">
                {chip.title}
              </span>
              {onRemoveFocus ? (
                <button
                  type="button"
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[#aaa] hover:bg-[#E8E6E1] hover:text-[#2c2c28]"
                  aria-label={clearLabel}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSegmentsChange(removeCardFromComposer(list, segment.nodeId));
                    onRemoveFocus(segment.nodeId);
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              ) : null}
            </span>
          );
        }
        if (!isLast && !segment.content) return null;
        return (
          <InlineText
            key={textSegmentKey(list, index)}
            textKey={textSegmentKey(list, index)}
            index={index}
            content={segment.content}
            isLast={isLast}
            disabled={disabled}
            onChange={(value) => onSegmentsChange(updateTextSegment(list, index, value))}
            onSubmit={onSubmit}
            onBlurPersist={onBlurPersist}
            onDeleteAdjacentChip={(side) => removeAdjacentCard(index, side)}
          />
        );
      })}
      {dropHint ? (
        <span
          data-testid="composer-drop-caret"
          aria-hidden
          className="pointer-events-none fixed z-[89] w-0.5 rounded-full bg-[#C2410C]"
          style={{ left: dropHint.x, top: dropHint.y, height: dropHint.height }}
        />
      ) : null}
      {ghost ? (
        <span
          data-testid="composer-drag-ghost"
          className="pointer-events-none fixed z-[90] inline-flex max-w-[9.5rem] items-center gap-1 rounded-full border border-[#C2410C]/50 bg-white py-px pl-0.5 pr-1.5 text-[11px] leading-4 text-[#2c2c28] shadow-sm"
          style={{ left: ghost.x + 10, top: ghost.y + 12 }}
        >
          {ghost.thumbnailSrc ? (
            <img src={ghost.thumbnailSrc} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#EFEDE8] text-[#8a8a82]">
              <FileText className="h-2.5 w-2.5" aria-hidden />
            </span>
          )}
          <span className="min-w-0 truncate">{ghost.title}</span>
        </span>
      ) : null}
    </div>
  );
}

function resolveDropHint(
  host: HTMLElement,
  clientX: number,
  clientY: number,
  fromIndex: number,
): DropHint | null {
  const slots = [...host.querySelectorAll<HTMLElement>('[data-segment-index]')].filter(
    (el) => Number(el.dataset.segmentIndex) !== fromIndex,
  );
  if (slots.length === 0) return null;
  const textSlots = slots.filter((el) => !el.dataset.composerChip);
  const chipSlots = slots.filter((el) => el.dataset.composerChip);

  const chipOver = pickSlotAtPoint(chipSlots, clientX, clientY, 0);
  if (chipOver) return edgeHintForChip(chipOver, clientX);

  const textOver = pickSlotAtPoint(textSlots, clientX, clientY, 4);
  if (textOver) return splitHintForText(textOver, clientX, clientY);

  const nearbyText = nearestTextOnLine(textSlots, clientX, clientY);
  if (nearbyText) return splitHintForText(nearbyText, clientX, clientY);

  let nearest = slots[0]!;
  let best = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const rect = slot.getBoundingClientRect();
    const dist =
      Math.abs(clientX - (rect.left + rect.width / 2)) + Math.abs(clientY - (rect.top + rect.height / 2));
    if (dist < best) {
      best = dist;
      nearest = slot;
    }
  }
  if (!nearest.dataset.composerChip) return splitHintForText(nearest, clientX, clientY);
  return edgeHintForChip(nearest, clientX);
}

function pickSlotAtPoint(
  slots: HTMLElement[],
  clientX: number,
  clientY: number,
  pad: number,
): HTMLElement | null {
  for (const slot of slots) {
    if (pointHitsFragment(slot, clientX, clientY, pad)) return slot;
  }
  return null;
}

function nearestTextOnLine(
  textSlots: HTMLElement[],
  clientX: number,
  clientY: number,
): HTMLElement | null {
  let nearest: HTMLElement | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const slot of textSlots) {
    const rects = fragmentRects(slot);
    for (const rect of rects) {
      if (clientY < rect.top - 10 || clientY > rect.bottom + 10) continue;
      const dist =
        clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      if (dist < best) {
        best = dist;
        nearest = slot;
      }
    }
  }
  return nearest;
}

function fragmentRects(el: HTMLElement): DOMRect[] {
  const rects = [...el.getClientRects()];
  return rects.length > 0 ? rects : [el.getBoundingClientRect()];
}

function pointHitsFragment(el: HTMLElement, x: number, y: number, pad: number): boolean {
  return fragmentRects(el).some((rect) => pointInRect(rect, x, y, pad));
}

function pointInRect(rect: DOMRect, x: number, y: number, pad: number): boolean {
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

function splitHintForText(span: HTMLElement, clientX: number, clientY: number): DropHint {
  const offset = caretOffsetFromPoint(span, clientX, clientY);
  const range = rangeForOffset(span, offset);
  const rect = rangeRectNear(range, span, clientX, clientY);
  return {
    index: Number(span.dataset.segmentIndex),
    place: 'split',
    offset,
    x: rect.left,
    y: rect.top,
    height: Math.max(rect.height, 16),
  };
}

function edgeHintForChip(chip: HTMLElement, clientX: number): DropHint {
  const rect = chip.getBoundingClientRect();
  const place = clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  return {
    index: Number(chip.dataset.segmentIndex),
    place,
    x: place === 'before' ? rect.left : rect.right,
    y: rect.top,
    height: Math.max(rect.height, 16),
  };
}

function caretOffsetFromPoint(span: HTMLElement, clientX: number, clientY: number): number {
  const text = span.textContent ?? '';
  if (text.length === 0) return 0;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset <= text.length; offset += 1) {
    const range = rangeForOffset(span, offset);
    const rect = rangeRectNear(range, span, clientX, clientY);
    const midY = rect.top + rect.height / 2;
    const dist = Math.abs(rect.left - clientX) + Math.abs(midY - clientY) * 0.35;
    if (dist < bestDist) {
      bestDist = dist;
      best = offset;
    }
  }
  return best;
}

function rangeForOffset(span: HTMLElement, offset: number): Range {
  const range = document.createRange();
  const walk = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let current: Node | null;
  while ((current = walk.nextNode())) {
    const len = current.textContent?.length ?? 0;
    if (remaining <= len) {
      range.setStart(current, remaining);
      range.collapse(true);
      return range;
    }
    remaining -= len;
  }
  range.selectNodeContents(span);
  range.collapse(false);
  return range;
}

function rangeRectNear(range: Range, fallback: HTMLElement, clientX: number, clientY: number): DOMRect {
  const rects = [...range.getClientRects()];
  const box = range.getBoundingClientRect();
  if (box.width > 0 || box.height > 0) rects.push(box);
  if (rects.length === 0) return fallback.getBoundingClientRect();
  let best = rects[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const rect of rects) {
    const dist = Math.abs(rect.left - clientX) + Math.abs(rect.top + rect.height / 2 - clientY);
    if (dist < bestDist) {
      bestDist = dist;
      best = rect;
    }
  }
  return best;
}

function textSegmentKey(list: ComposerSegment[], index: number): string {
  const left = list
    .slice(0, index)
    .reverse()
    .find((segment): segment is Extract<ComposerSegment, { type: 'card' }> => segment.type === 'card');
  const right = list
    .slice(index + 1)
    .find((segment): segment is Extract<ComposerSegment, { type: 'card' }> => segment.type === 'card');
  return `text-${left?.nodeId ?? 'start'}-${right?.nodeId ?? 'end'}`;
}

function InlineText({
  index,
  textKey,
  content,
  isLast,
  disabled,
  onChange,
  onSubmit,
  onBlurPersist,
  onDeleteAdjacentChip,
}: {
  index: number;
  textKey: string;
  content: string;
  isLast: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onBlurPersist?: () => void;
  onDeleteAdjacentChip: (side: 'before' | 'after') => boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const focusedRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const current = (el.textContent ?? '').replace(/\u200b/g, '');
    if (current === content) return;
    const keepCaret = focusedRef.current || document.activeElement === el;
    const caret = keepCaret ? readPlainTextOffset(el) : null;
    el.textContent = content;
    if (keepCaret) placeCaretAtOffset(el, Math.min(caret ?? content.length, content.length));
  }, [content]);

  const read = () => (ref.current?.textContent ?? '').replace(/\u200b/g, '').replace(/\r?\n/g, '');

  const flattenDom = () => {
    const el = ref.current;
    if (!el) return;
    const text = read();
    if (el.childElementCount === 0 && (el.textContent ?? '').replace(/\u200b/g, '') === text) return;
    const caret = readPlainTextOffset(el);
    el.textContent = text;
    if (focusedRef.current || document.activeElement === el) {
      placeCaretAtOffset(el, Math.min(caret, text.length));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    if (e.nativeEvent.isComposing) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    if (sel.anchorNode !== e.currentTarget && !e.currentTarget.contains(sel.anchorNode)) return;
    const offset = readPlainTextOffset(e.currentTarget);
    const len = read().length;
    if (e.key === 'Backspace' && offset === 0 && onDeleteAdjacentChip('before')) {
      e.preventDefault();
    }
    if (e.key === 'Delete' && offset >= len && onDeleteAdjacentChip('after')) {
      e.preventDefault();
    }
  };

  return (
    <span
      ref={ref}
      data-segment-index={index}
      data-text-key={textKey}
      data-testid={isLast ? 'canvas-chat-input' : undefined}
      role={isLast ? 'textbox' : undefined}
      contentEditable={disabled ? false : 'plaintext-only'}
      suppressContentEditableWarning
      aria-multiline={isLast || undefined}
      className={`inline cursor-text align-baseline outline-none [&_br]:hidden ${
        isLast && !content ? 'min-w-[1ch]' : ''
      }`}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        flattenDom();
        onChange(read());
        onBlurPersist?.();
      }}
      onInput={() => {
        flattenDom();
        onChange(read());
      }}
      onKeyDown={onKeyDown}
    />
  );
}

function readPlainTextOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (range.startContainer !== el && !el.contains(range.startContainer)) {
    return (el.textContent ?? '').length;
  }
  const prefix = document.createRange();
  prefix.selectNodeContents(el);
  try {
    prefix.setEnd(range.startContainer, range.startOffset);
  } catch {
    return (el.textContent ?? '').length;
  }
  return prefix.toString().length;
}
