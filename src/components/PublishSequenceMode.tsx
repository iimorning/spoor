import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eraser, Loader2, Undo2, X } from 'lucide-react';
import { canvasOverlayProps } from '../utils/canvasOverlay';
import {
  appendPublishOrderId,
  hitTestPublishCandidate,
} from '../utils/publishStrokeSequence';

export type PublishSequenceModeProps = {
  active: boolean;
  candidateIds: readonly string[];
  orderedIds: readonly string[];
  setOrderedIds: React.Dispatch<React.SetStateAction<string[]>>;
  nodesRef: React.RefObject<Record<string, HTMLElement | null>>;
  mainRef: React.RefObject<HTMLDivElement | null>;
  generating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

type StrokePoint = { x: number; y: number };

/**
 * Full-viewport capture while publishing: brush over selected cards to set
 * reading order. Confirms with a bottom bar (no AI arrange).
 */
export function PublishSequenceMode({
  active,
  candidateIds,
  orderedIds,
  setOrderedIds,
  nodesRef,
  mainRef,
  generating,
  onCancel,
  onConfirm,
}: PublishSequenceModeProps) {
  const { t } = useTranslation();
  const [strokePoints, setStrokePoints] = useState<StrokePoint[]>([]);
  const strokingRef = useRef(false);
  const orderedRef = useRef(orderedIds);
  orderedRef.current = orderedIds;

  const tryHit = useCallback(
    (clientX: number, clientY: number) => {
      const hit = hitTestPublishCandidate(
        clientX,
        clientY,
        candidateIds,
        nodesRef.current,
        new Set(orderedRef.current),
      );
      if (!hit) return;
      setOrderedIds((prev) => appendPublishOrderId(prev, hit));
    },
    [candidateIds, nodesRef, setOrderedIds],
  );

  const toLocal = useCallback(
    (clientX: number, clientY: number): StrokePoint | null => {
      const main = mainRef.current;
      if (!main) return null;
      const b = main.getBoundingClientRect();
      return { x: clientX - b.left, y: clientY - b.top };
    },
    [mainRef],
  );

  useEffect(() => {
    if (!active) {
      setStrokePoints([]);
      strokingRef.current = false;
    }
  }, [active]);

  useEffect(() => {
    if (generating) {
      setStrokePoints([]);
      strokingRef.current = false;
    }
  }, [generating]);

  useEffect(() => {
    if (!active || generating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, generating, onCancel]);

  if (!active) return null;

  const remaining = candidateIds.length - orderedIds.length;
  const canConfirm = orderedIds.length >= 2 && !generating;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (generating || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    strokingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = toLocal(e.clientX, e.clientY);
    setStrokePoints(pt ? [pt] : []);
    tryHit(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!strokingRef.current || generating) return;
    const pt = toLocal(e.clientX, e.clientY);
    if (pt) setStrokePoints((prev) => (prev.length > 400 ? [...prev.slice(-300), pt] : [...prev, pt]));
    tryHit(e.clientX, e.clientY);
  };

  const endStroke = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!strokingRef.current) return;
    strokingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    // Selection order lives on the numbered badges — drop the brush trail
    // as soon as the stroke ends so it does not linger over the canvas.
    setStrokePoints([]);
  };

  const polyline =
    strokePoints.length > 1
      ? strokePoints.map((p) => `${p.x},${p.y}`).join(' ')
      : '';

  return (
    <>
      <div
        data-testid="publish-sequence-layer"
        className="absolute inset-0 z-[45] cursor-crosshair touch-none"
        style={{ pointerEvents: generating ? 'none' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      >
        <svg className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden>
          {polyline ? (
            <polyline
              points={polyline}
              fill="none"
              stroke="rgba(194, 65, 12, 0.55)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
      </div>

      <div
        {...canvasOverlayProps}
        data-testid="publish-sequence-bar"
        className="absolute bottom-6 left-1/2 z-[50] flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-[#E6E4DF] bg-white/95 px-3 py-2 shadow-lg"
      >
        <p className="max-w-[14rem] px-1 text-[12px] leading-snug text-[#5a5a54] sm:max-w-none">
          {generating
            ? t('publish.generating')
            : t('publish.sequence_hint', {
                brushed: orderedIds.length,
                total: candidateIds.length,
              })}
        </p>
        {remaining > 0 && !generating ? (
          <span className="text-[11px] text-[#8c8a84]">{t('publish.sequence_remainder_hint')}</span>
        ) : null}
        <button
          type="button"
          data-testid="publish-sequence-undo"
          disabled={orderedIds.length === 0 || generating}
          onClick={() => setOrderedIds((prev) => prev.slice(0, -1))}
          className="flex h-8 items-center gap-1 rounded-lg border border-[#E6E4DF] px-2 text-[12px] text-[#5a5a54] hover:border-[#C2410C] hover:text-[#C2410C] disabled:opacity-40"
          title={t('publish.sequence_undo')}
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          {t('publish.sequence_undo')}
        </button>
        <button
          type="button"
          data-testid="publish-sequence-clear"
          disabled={orderedIds.length === 0 || generating}
          onClick={() => {
            setOrderedIds([]);
            setStrokePoints([]);
          }}
          className="flex h-8 items-center gap-1 rounded-lg border border-[#E6E4DF] px-2 text-[12px] text-[#5a5a54] hover:border-[#C2410C] hover:text-[#C2410C] disabled:opacity-40"
          title={t('publish.sequence_clear')}
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden />
          {t('publish.sequence_clear')}
        </button>
        <button
          type="button"
          data-testid="publish-sequence-cancel"
          disabled={generating}
          onClick={onCancel}
          className="flex h-8 items-center gap-1 rounded-lg border border-[#E6E4DF] px-2 text-[12px] text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          {t('publish.sequence_cancel')}
        </button>
        <button
          type="button"
          data-testid="publish-sequence-confirm"
          disabled={!canConfirm}
          onClick={onConfirm}
          className="flex h-8 items-center gap-1 rounded-lg bg-[#C2410C] px-3 text-[12px] font-semibold text-white hover:bg-[#a0350a] disabled:opacity-40"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden />
          )}
          {generating ? t('publish.generating') : t('publish.confirm_generate')}
        </button>
      </div>
    </>
  );
}

/** Number badge in canvas world space (inside the scaled content container). */
export function PublishSequenceBadge({
  index,
  x,
  y,
}: {
  index: number;
  x: number;
  y: number;
}) {
  return (
    <div
      data-testid={`publish-sequence-badge-${index}`}
      className="pointer-events-none absolute z-[60] flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[#C2410C] text-[13px] font-bold text-white shadow-md"
      style={{ left: x, top: y }}
      aria-hidden
    >
      {index}
    </div>
  );
}
