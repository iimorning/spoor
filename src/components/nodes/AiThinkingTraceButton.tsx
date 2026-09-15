import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain } from 'lucide-react';
import { AI_THINKING_SCROLL_MAX_HEIGHT_PX } from '../../utils/canvas';

export function AiThinkingTraceButton({
  text,
  touchChrome = false,
  onOpenChange,
}: {
  text: string;
  touchChrome?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const body = text.trim();

  const setOpenAndNotify = (next: boolean | ((prev: boolean) => boolean)) => {
    setOpen((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      onOpenChange?.(value);
      return value;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setOpenAndNotify(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenAndNotify(false);
    };
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!body) return null;

  return (
    <div ref={rootRef} className="relative flex items-center">
      <button
        type="button"
        data-testid="ai-thinking-trace"
        aria-expanded={open}
        aria-label={t('nodes.ai_thinking_view')}
        title={t('nodes.ai_thinking_view')}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          setOpenAndNotify((v) => !v);
        }}
        className={`${
          touchChrome ? 'w-9 h-9' : 'w-6 h-6'
        } rounded-full flex items-center justify-center transition-all shadow-sm ${
          open
            ? 'bg-[#C2410C] border border-[#E6E4DF] text-white'
            : 'bg-white border border-[#E6E4DF] text-[#8c8a84] hover:text-[#C2410C] hover:border-[#C2410C]'
        }`}
      >
        <Brain className={touchChrome ? 'w-4 h-4' : 'w-3.5 h-3.5'} strokeWidth={1.75} />
      </button>
      {open ? (
        <div
          className="node-thinking-panel absolute left-full bottom-0 z-30 ml-2 w-72 max-w-[min(18rem,70vw)] rounded-xl border border-[#E6E4DF] bg-white/95 p-2.5 shadow-md backdrop-blur-md"
          data-testid="ai-thinking-trace-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8c8a84]">
            {t('nodes.ai_thinking_label')}
          </div>
          <div
            data-no-drag=""
            className="overflow-y-auto overscroll-contain scrollbar-hide whitespace-pre-wrap text-sm text-[#5a5a54] italic font-serif leading-relaxed"
            style={{ maxHeight: AI_THINKING_SCROLL_MAX_HEIGHT_PX }}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
            }}
          >
            {body}
          </div>
        </div>
      ) : null}
    </div>
  );
}
