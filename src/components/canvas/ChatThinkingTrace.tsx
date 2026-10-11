import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Brain, GripVertical } from 'lucide-react';
import { CHAT_REPLY_DRAG_HANDLE_CLASS } from './chatPanelStyles';
import { AI_THINKING_SCROLL_MAX_HEIGHT_PX } from '../../utils/canvas';
import { useTextSelectionToolbar } from '../../hooks/useTextSelectionToolbar';
import { TextSelectionToolbar, TextSelectionToolbarButton } from '../TextSelectionToolbar';

export function resolveChatThought(input: {
  thinkingTrace?: string;
  isStreaming?: boolean;
  streamingThought?: string;
}): string {
  if (input.isStreaming && (input.streamingThought ?? '').trim()) {
    return input.streamingThought!.trim();
  }
  return (input.thinkingTrace ?? '').trim();
}

export function ChatThinkingTrace({
  name,
  nameClassName,
  below,
  thought,
  messageId,
  canEdit,
  onExcerptSelection,
  onDropThinkingAt,
  onDropSelectionAt,
}: {
  name: ReactNode;
  nameClassName?: string;
  below?: ReactNode;
  thought: string;
  messageId: string;
  canEdit: boolean;
  onExcerptSelection: (text: string) => void;
  onDropThinkingAt?: (messageId: string, clientX: number, clientY: number) => void;
  onDropSelectionAt?: (messageId: string, text: string, clientX: number, clientY: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const body = thought.trim();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="flex w-full min-w-0 flex-col items-stretch gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`min-w-0 ${nameClassName ?? 'truncate'}`}>{name}</span>
        {body ? (
          <button
            type="button"
            data-testid="chat-thinking-trace"
            aria-expanded={open}
            aria-label={t('nodes.ai_thinking_view')}
            title={t('nodes.ai_thinking_view')}
            onClick={() => setOpen((v) => !v)}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all ${
              open
                ? 'border-[#E6E4DF] bg-[#C2410C] text-white'
                : 'border-[#E6E4DF] bg-white text-[#8c8a84] hover:border-[#C2410C] hover:text-[#C2410C]'
            }`}
          >
            <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {below}
      {open && body ? (
        <ChatThinkingCard
          thought={body}
          messageId={messageId}
          canEdit={canEdit}
          onExcerptSelection={(text) => {
            onExcerptSelection(text);
            setOpen(true);
          }}
          onDropThinkingAt={onDropThinkingAt}
          onDropSelectionAt={onDropSelectionAt}
        />
      ) : null}
    </div>
  );
}

function ChatThinkingCard({
  thought,
  messageId,
  canEdit,
  onExcerptSelection,
  onDropThinkingAt,
  onDropSelectionAt,
}: {
  thought: string;
  messageId: string;
  canEdit: boolean;
  onExcerptSelection: (text: string) => void;
  onDropThinkingAt?: (messageId: string, clientX: number, clientY: number) => void;
  onDropSelectionAt?: (messageId: string, text: string, clientX: number, clientY: number) => void;
}) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const {
    askUi,
    toolbarRef,
    quoteRef,
    updateSelectionAsk,
    dismissSelectionToolbar,
    arm,
    disarm,
  } = useTextSelectionToolbar({
    bodyRef,
    sourceLabel: t('nodes.ai_thinking_label'),
    disabled: !canEdit,
    toolbarWidth: 148,
    positionMode: 'viewport',
    clampSelector: '[data-testid="canvas-chat-panel"]',
  });
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; text?: string } | null>(null);
  const canDrag = Boolean(onDropThinkingAt) && canEdit;

  const beginSelectionDrag = (text: string, originX: number, originY: number) => {
    const snippet = text.replace(/\s+/g, ' ').trim();
    if (!onDropSelectionAt || snippet.length < 2) return;
    let armed = false;
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - originX;
      const dy = move.clientY - originY;
      if (!armed) {
        if (dx * dx + dy * dy < 16) return;
        armed = true;
      }
      setDragGhost({ x: move.clientX, y: move.clientY, text: snippet });
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragGhost(null);
      if (!armed) return;
      onDropSelectionAt(messageId, snippet, up.clientX, up.clientY);
      dismissSelectionToolbar();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canDrag || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    let armed = false;
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - e.clientX;
      const dy = move.clientY - e.clientY;
      if (!armed) {
        if (dx * dx + dy * dy < 16) return;
        armed = true;
      }
      setDragGhost({ x: move.clientX, y: move.clientY, text: thought });
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragGhost(null);
      if (!armed) return;
      onDropThinkingAt?.(messageId, up.clientX, up.clientY);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      className="group/message relative w-full rounded-2xl border border-[#E6E4DF] bg-white/95 p-3 shadow-sm"
      data-testid="chat-thinking-trace-panel"
    >
      {canDrag ? (
        <button
          type="button"
          onPointerDown={onHandlePointerDown}
          title={t('canvas.v2.drag_thinking_to_canvas')}
          aria-label={t('canvas.v2.drag_thinking_to_canvas')}
          className={CHAT_REPLY_DRAG_HANDLE_CLASS}
        >
          <GripVertical className="h-3 w-3" />
        </button>
      ) : null}
      <div className="mb-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8c8a84]">
        {t('nodes.ai_thinking_label')}
      </div>
      <div
        ref={bodyRef}
        data-no-drag=""
        onMouseUp={updateSelectionAsk}
        onPointerDown={(e) => {
          if (!onDropSelectionAt || !canEdit || e.button !== 0) return;
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed || !bodyRef.current) return;
          if (!bodyRef.current.contains(sel.anchorNode) || !bodyRef.current.contains(sel.focusNode)) return;
          const text = sel.toString();
          if (text.replace(/\s+/g, ' ').trim().length < 2) return;
          e.preventDefault();
          e.stopPropagation();
          beginSelectionDrag(text, e.clientX, e.clientY);
        }}
        className="cursor-text select-text overflow-y-auto overscroll-contain whitespace-pre-wrap font-serif text-sm italic leading-relaxed text-[#5a5a54] scrollbar-hide"
        style={{ maxHeight: AI_THINKING_SCROLL_MAX_HEIGHT_PX }}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
        }}
      >
        {thought}
      </div>
      {askUi && canEdit ? (
        <TextSelectionToolbar
          top={askUi.top}
          left={askUi.left}
          toolbarRef={toolbarRef}
          onArm={arm}
          onDisarm={disarm}
          placement="fixed"
        >
          <button
            type="button"
            title={t('canvas.v2.drag_selection_to_canvas')}
            aria-label={t('canvas.v2.drag_selection_to_canvas')}
            className="flex h-6 w-5 cursor-grab items-center justify-center rounded-md text-[#C2410C] hover:bg-[#FFF7ED] active:cursor-grabbing"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              arm();
              const text = quoteRef.current?.text ?? '';
              beginSelectionDrag(text, e.clientX, e.clientY);
            }}
          >
            <GripVertical className="h-3 w-3" />
          </button>
          <TextSelectionToolbarButton
            variant="primary"
            onArm={arm}
            onAction={() => {
              const quote = quoteRef.current;
              if (!quote) return;
              onExcerptSelection(quote.text);
              dismissSelectionToolbar();
            }}
          >
            {t('canvas.v2.excerpt_selection', { defaultValue: '摘录' })}
          </TextSelectionToolbarButton>
        </TextSelectionToolbar>
      ) : null}
      {dragGhost
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-[80] max-w-xs rounded-2xl border border-[#C2410C]/40 bg-white px-3 py-2 text-xs italic leading-relaxed text-[#5a5a54] shadow-lg"
              style={{
                left: dragGhost.x,
                top: dragGhost.y,
                transform: 'translate(-8px, -8px)',
              }}
            >
              {(dragGhost.text ?? thought).slice(0, 160)}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
