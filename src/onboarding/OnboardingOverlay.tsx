/**
 * Onboarding tour overlay: dimmed backdrop, target highlight cutout, and a
 * positioned tooltip card with Skip / Next controls. Mount once at the App
 * root, controlled by `useOnboarding`.
 *
 * - Z-index 130 (above EssayFullscreen at 125, AppDialogProvider at 128, AISettingsModal at 100).
 * - Backdrop is a single `fixed inset-0` div with `bg-black/55`.
 * - Highlight cutout is the undimmed hole left by four dim strips. No colored
 *   frame — the target stays bright against the backdrop.
 * - Esc closes (capture-phase listener); the tooltip Skip link does the same.
 * - Recalculates target rect on resize/scroll and on `currentIndex` change.
 * - If the target cannot be found after 5 short retries, the step is silently
 *   skipped (no toast) — this keeps the tour resilient on empty canvases.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { OnboardingStep, Placement } from './useOnboarding';
import { onboardingBodyLines } from './onboardingBodyLines';
import { unionClientRects } from './onboardingHighlight';
import { waitingLabelKeyForGate } from './onboardingGates';
import { OnboardingGestureDemo } from './OnboardingGestureDemo';
import { OnboardingCanvasArrow } from './OnboardingCanvasArrow';
import { positionTooltip, type PositionedTooltip } from './positionTooltip';

const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 50;
const VIEWPORT_MARGIN = 8;

export interface OnboardingOverlayProps {
  step: OnboardingStep | null;
  currentIndex: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
  /** Required so cross-tab steps can switch tabs before the overlay paints. */
  onBeforeShow?: (step: OnboardingStep) => void | Promise<void>;
  /** When false, Next stays disabled (gated steps wait for user action). */
  canAdvance?: boolean;
  /** Optional world→screen highlight (work room cutout). Falls back to `targetTestId`. */
  resolveHighlightRect?: (step: OnboardingStep) => DOMRect | null;
  /** Multiple cutouts (e.g. room + outside materials). Overrides single rect when set. */
  resolveHighlightRects?: (step: OnboardingStep) => DOMRect[];
  /** Tooltip positions against this rect when set; otherwise uses the cutout rect. */
  resolveTooltipAnchorRect?: (step: OnboardingStep) => DOMRect | null;
  /** Bumps when pan/zoom changes so the cutout tracks the room. */
  highlightRevision?: string;
  /** Animated drag hint drawn above the dim layer. */
  dragArrowRects?: { from: DOMRect; to: DOMRect } | null;
  /** Element to return focus to when the tour closes. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

interface TargetState {
  rect: DOMRect | null;
  highlightRects: DOMRect[];
  placement: Placement;
  tooltipPos: { top: number; left: number };
}

const FALLBACK_TARGET: TargetState = {
  rect: null,
  highlightRects: [],
  placement: 'bottom',
  tooltipPos: { top: 100, left: 100 },
};

function OnboardingRichLine({ text }: { text: string }) {
  return (
    <Trans
      defaults={text}
      components={{
        hl: <span className="font-semibold text-[#C2410C]" />,
      }}
    />
  );
}

function OnboardingBody({
  id,
  lines,
  bodyRich = false,
}: {
  id: string;
  lines: string[];
  bodyRich?: boolean;
}) {
  if (lines.length === 0) return null;
  if (lines.length === 1 && !bodyRich) {
    return (
      <p id={id} className="text-base text-[#5a5a54] leading-relaxed mb-4">
        {lines[0]}
      </p>
    );
  }
  return (
    <ul
      id={id}
      className="mb-4 space-y-2.5 text-base text-[#5a5a54] leading-relaxed list-none p-0"
    >
      {lines.map((line, index) => (
        <li key={index} className="flex gap-2.5">
          <span
            className="mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full bg-[#C2410C]"
            aria-hidden
          />
          <span>{bodyRich ? <OnboardingRichLine text={line} /> : line}</span>
        </li>
      ))}
    </ul>
  );
}

export function OnboardingOverlay({
  step,
  currentIndex,
  totalSteps,
  onNext,
  onSkip,
  onBeforeShow,
  canAdvance = true,
  resolveHighlightRect,
  resolveHighlightRects,
  resolveTooltipAnchorRect,
  highlightRevision,
  dragArrowRects,
  returnFocusRef,
}: OnboardingOverlayProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<TargetState>(FALLBACK_TARGET);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const skipLinkRef = useRef<HTMLButtonElement | null>(null);
  const dimMaskId = useId().replace(/:/g, '');

  const measure = useCallback(() => {
    if (!step) return;
    const highlightRects = resolveHighlightRects?.(step) ?? [];
    const customRect = resolveHighlightRect?.(step) ?? null;
    const el = customRect || highlightRects.length > 0
      ? null
      : (document.querySelector(
          `[data-testid="${CSS.escape(step.targetTestId)}"]`,
        ) as HTMLElement | null);
    const cutoutRects =
      highlightRects.length > 0
        ? highlightRects
        : customRect
          ? [customRect]
          : [];
    const cutoutRect =
      cutoutRects.length > 0
        ? cutoutRects.reduce((union, next) =>
            union ? unionClientRects(union, next) : next,
          )
        : el?.getBoundingClientRect() ?? null;
    if (!cutoutRect) {
      setTarget(FALLBACK_TARGET);
      return;
    }
    const anchorRect = resolveTooltipAnchorRect?.(step) ?? cutoutRect;
    const tooltipEl = tooltipRef.current;
    const tooltipSize = tooltipEl
      ? { width: tooltipEl.offsetWidth, height: tooltipEl.offsetHeight }
      : { width: 360, height: 180 };
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const positioned: PositionedTooltip = positionTooltip(
      anchorRect,
      tooltipSize,
      viewport,
      step.placement ?? 'bottom',
      step.placementAlign ?? 'center',
    );
    setTarget({
      rect: cutoutRect,
      highlightRects: cutoutRects,
      placement: positioned.placement,
      tooltipPos: { top: positioned.top, left: positioned.left },
    });
  }, [step, resolveHighlightRect, resolveHighlightRects, resolveTooltipAnchorRect]);

  // beforeShow → wait → measure target. Retry on miss.
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    let attempt = 0;

    const tryShow = async () => {
      if (onBeforeShow) {
        try {
          await onBeforeShow(step);
        } catch {
          // ignore — tour must keep moving
        }
      }
      const tick = () => {
        if (cancelled) return;
        const highlightRects = resolveHighlightRects?.(step) ?? [];
        const highlightRect = resolveHighlightRect?.(step) ?? null;
        const el = highlightRect || highlightRects.length > 0
          ? null
          : document.querySelector(`[data-testid="${CSS.escape(step.targetTestId)}"]`);
        if (highlightRects.length > 0 || highlightRect || el) {
          // Two RAFs to let layout settle before measuring.
          requestAnimationFrame(() => {
            if (!cancelled) measure();
          });
          return;
        }
        if (attempt < RETRY_COUNT) {
          attempt += 1;
          setTimeout(tick, RETRY_DELAY_MS);
        } else {
          // Target missing — silently advance to next step.
          console.warn(
            `[onboarding] target "${step.targetTestId}" not found, skipping step "${step.id}"`,
          );
          onNext();
        }
      };
      tick();
    };
    tryShow();
    return () => {
      cancelled = true;
    };
    // measure() captures `step`; intentionally keying on currentIndex only to
    // avoid re-measuring when the step object identity churns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, highlightRevision]);

  // Recompute when pan/zoom moves the work-room cutout.
  useEffect(() => {
    if (!step?.highlight || !highlightRevision) return;
    measure();
  }, [highlightRevision, measure, step?.highlight]);

  // Recompute on resize/scroll. capture phase so canvas doesn't swallow scroll.
  useEffect(() => {
    if (!step) return;
    const handler = () => measure();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, { capture: true });
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [step, measure]);

  // After tooltip mounts/updates, remeasure with its real size.
  useLayoutEffect(() => {
    if (!step) return;
    requestAnimationFrame(measure);
  }, [step, currentIndex, measure]);

  // Esc closes (capture-phase listener so settings/dialog Escape doesn't fight us).
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onSkip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, onSkip]);

  // Return focus when overlay unmounts.
  useEffect(() => {
    if (!step) return;
    return () => {
      returnFocusRef?.current?.focus?.();
    };
  }, [step, returnFocusRef]);

  // Move keyboard focus into the overlay so Tab/Enter navigate controls.
  useEffect(() => {
    if (!step) return;
    skipLinkRef.current?.focus();
  }, [step, currentIndex]);

  if (!step) return null;

  const { rect, highlightRects, tooltipPos } = target;
  const waitingKey = canAdvance ? null : waitingLabelKeyForGate(step.gate);
  const nextDisabled = !canAdvance;

  return (
    <div
      data-testid="onboarding-backdrop"
      className="fixed inset-0 z-[130] pointer-events-none"
      role="presentation"
      aria-hidden={rect === null}
    >
      {/* Dim the area around the target with 4 rectangles — leaves the target
          itself fully uncovered so it stays bright and clickable. */}
      {rect && (
        <>
          {highlightRects.length > 1 ? (
            <svg
              className="absolute inset-0 h-full w-full pointer-events-none"
              aria-hidden
            >
              <defs>
                <mask id={dimMaskId}>
                  <rect width="100%" height="100%" fill="white" />
                  {highlightRects.map((hole, index) => (
                    <rect
                      key={index}
                      x={hole.left}
                      y={hole.top}
                      width={hole.width}
                      height={hole.height}
                      rx={8}
                      fill="black"
                    />
                  ))}
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                fill="rgb(0 0 0 / 0.35)"
                mask={`url(#${dimMaskId})`}
              />
            </svg>
          ) : (
            <>
              <div
                className="absolute left-0 right-0 top-0 bg-black/35"
                style={{ height: rect.top }}
              />
              <div
                className="absolute left-0 right-0 bottom-0 bg-black/35"
                style={{ top: rect.bottom }}
              />
              <div
                className="absolute top-0 bottom-0 left-0 bg-black/35"
                style={{ top: rect.top, width: rect.left, height: rect.height }}
              />
              <div
                className="absolute top-0 bottom-0 right-0 bg-black/35"
                style={{ top: rect.top, left: rect.right, height: rect.height }}
              />
            </>
          )}

          {(highlightRects.length > 0 ? highlightRects : [rect]).map((hole, index) => (
            <div
              key={index}
              data-testid={index === 0 ? 'onboarding-cutout' : undefined}
              aria-hidden
              className={`absolute rounded-lg ${step.highlight ? 'ring-2 ring-[#C2410C]/40 shadow-[0_0_0_1px_rgba(194,65,12,0.15)]' : ''}`}
              style={{
                top: hole.top,
                left: hole.left,
                width: hole.width,
                height: hole.height,
                transition:
                  'top 180ms ease, left 180ms ease, width 180ms ease, height 180ms ease',
              }}
            />
          ))}
        </>
      )}

      {dragArrowRects ? (
        <OnboardingCanvasArrow from={dragArrowRects.from} to={dragArrowRects.to} />
      ) : null}

      {/* Tooltip — re-enable pointer events so the buttons work. */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={`onboarding-title-${step.id}`}
        aria-describedby={`onboarding-body-${step.id}`}
        data-testid="onboarding-tooltip"
        className="absolute w-[380px] max-w-[calc(100vw-32px)] rounded-2xl bg-white shadow-2xl border border-[#E6E4DF] p-6 pointer-events-auto"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
        }}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">
            {currentIndex + 1} / {totalSteps}
          </span>
          <button
            ref={skipLinkRef}
            type="button"
            onClick={onSkip}
            data-testid="onboarding-skip"
            className="text-[11px] font-semibold text-[#8c8a84] hover:text-[#5a5a54] focus:outline-none focus-visible:underline"
          >
            {t('onboarding.cta_skip')}
          </button>
        </div>
        <h2
          id={`onboarding-title-${step.id}`}
          className="text-xl font-bold text-[#1a1a1a] mb-3 leading-snug"
        >
          {t(step.copy.titleKey)}
        </h2>
        <OnboardingBody
          id={`onboarding-body-${step.id}`}
          lines={onboardingBodyLines(t(step.copy.bodyKey, { returnObjects: true }))}
          bodyRich={step.copy.bodyRich}
        />
        {step.demo ? <OnboardingGestureDemo kind={step.demo} /> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled}
            data-testid="onboarding-next"
            className={`px-5 py-2.5 rounded-lg text-base font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2 ${
              nextDisabled
                ? 'bg-[#E8E6E1] text-[#8a8a82] cursor-not-allowed'
                : 'bg-[#C2410C] text-white hover:bg-[#9A3412]'
            }`}
          >
            {waitingKey ? t(waitingKey) : t(step.nextLabelKey ?? 'onboarding.cta_next')}
          </button>
        </div>
      </div>

      {/* Visual padding so the tooltip never touches the cutout exactly. */}
      <div style={{ marginTop: VIEWPORT_MARGIN }} aria-hidden />
    </div>
  );
}