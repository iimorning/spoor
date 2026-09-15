/**
 * Onboarding tour state machine + localStorage persistence.
 *
 * The hook owns whether the tour is visible and which step is current. Storage
 * is a single `'true'` flag under `onboarding_completed_v7`; absence means the
 * user has not seen the tour yet. The suffix is bumped when the walkthrough
 * changes materially (v8: compose-essay step after drag-to-canvas).
 *
 * Pattern follows `src/hooks/useCanvasGrid.ts` — try/catch around localStorage
 * to survive private-mode / quota errors.
 */

import { useCallback, useState } from 'react';
import type { OnboardingGate } from './onboardingGates';
import type { OnboardingHighlightMode } from './onboardingHighlight';

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export type ActiveTab = 'personal' | 'archive' | 'agents';

export interface OnboardingStep {
  id: string;
  targetTestId: string;
  copy: {
    titleKey: string;
    bodyKey: string;
    /** Render body with inline `<hl>` highlights via i18n Trans. */
    bodyRich?: boolean;
  };
  placement?: Placement;
  /** Vertical alignment for left/right tooltips; horizontal for top/bottom. */
  placementAlign?: 'start' | 'center' | 'end';
  requireTab?: ActiveTab;
  /** Async hook executed before this step's overlay paints. Use to switch tabs. */
  beforeShow?: (ctx: { setActiveTab: (tab: ActiveTab) => void }) => void | Promise<void>;
  /** Override the next button label (e.g. last step: "Done"). */
  nextLabelKey?: string;
  /** Looping gesture cartoon in the tooltip (box-select, pan, or drag-in). */
  demo?: 'marquee' | 'pan' | 'drag-in';
  /** Animated hint drawn on the canvas (not inside the tooltip). */
  canvasArrow?: 'drag-in';
  /** When set, the Next button stays disabled until the gate is satisfied (App auto-advances). */
  gate?: OnboardingGate;
  /** Screen cutout follows the work room (and optionally outside starter cards). */
  highlight?: OnboardingHighlightMode;
  /** Tooltip placement anchor — defaults to the highlight cutout. */
  tooltipAnchor?: 'highlight' | 'outside-materials';
}

export interface OnboardingController {
  isActive: boolean;
  currentIndex: number;
  currentStep: OnboardingStep | null;
  totalSteps: number;
  start: () => void;
  /**
   * Open the tour only if this browser has not already seen it. Canvas
   * template tours use this so switching canvases (or remounting App) does
   * not replay a walkthrough the user already got.
   */
  startIfUnseen: () => void;
  next: () => void;
  skip: () => void;
  restart: () => void;
}

export const ONBOARDING_STORAGE_KEY = 'onboarding_completed_v8';
export const ONBOARDING_INTUITION_PUMP_STORAGE_KEY = 'onboarding_intuition_pump_v1';
export const ONBOARDING_TURTLE_SOUP_STORAGE_KEY = 'onboarding_turtle_soup_v1';

function readDone(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

function writeDone(storageKey: string, done: boolean): void {
  try {
    if (done) localStorage.setItem(storageKey, 'true');
    else localStorage.removeItem(storageKey);
  } catch {
    // private mode / quota — fail silently; tour still works in-memory
  }
}

export interface UseOnboardingOptions {
  /**
   * localStorage key the "tour has been seen" flag lives under. Defaults to
   * the global `ONBOARDING_STORAGE_KEY`. Canvas-specific tours (e.g. the
   * intuition-pump walkthrough) pass their own key so each tour has its own
   * seen/unseen state.
   */
  storageKey?: string;
  /**
   * Override whether the tour auto-opens on first mount. When `undefined`,
   * the tour auto-opens if the storage flag is absent (matching the
   * default behavior). Pass `false` to mount the tour silent — useful for
   * canvas-specific tours that only fire when the user lands on the
   * matching canvas.
   */
  initialActive?: boolean;
}

export function useOnboarding(
  steps: OnboardingStep[],
  options: UseOnboardingOptions = {},
): OnboardingController {
  const totalSteps = steps.length;
  const storageKey = options.storageKey ?? ONBOARDING_STORAGE_KEY;
  // First mount decides whether to auto-open: no flag in localStorage → tour shows.
  const [isActive, setIsActive] = useState<boolean>(() => {
    if (typeof options.initialActive === 'boolean') return options.initialActive;
    return !readDone(storageKey);
  });
  const [currentIndex, setCurrentIndex] = useState(0);

  const finish = useCallback(() => {
    setIsActive(false);
    writeDone(storageKey, true);
  }, [storageKey]);

  const start = useCallback(() => {
    setCurrentIndex(0);
    setIsActive(true);
  }, []);

  const startIfUnseen = useCallback(() => {
    if (readDone(storageKey)) return;
    // Stamp seen immediately so a later liveQuery tick or canvas switch
    // cannot call start() again and jump the tooltip back to step 1.
    writeDone(storageKey, true);
    setCurrentIndex(0);
    setIsActive(true);
  }, [storageKey]);

  const next = useCallback(() => {
    setCurrentIndex((idx) => {
      const nextIdx = idx + 1;
      if (nextIdx >= totalSteps) {
        // Reached the end — close and mark done.
        finish();
        return idx;
      }
      return nextIdx;
    });
  }, [totalSteps, finish]);

  const skip = useCallback(() => {
    finish();
  }, [finish]);

  const restart = useCallback(() => {
    writeDone(storageKey, false);
    start();
  }, [start, storageKey]);

  const currentStep = isActive && steps[currentIndex] ? steps[currentIndex] : null;

  return {
    isActive,
    currentIndex,
    currentStep,
    totalSteps,
    start,
    startIfUnseen,
    next,
    skip,
    restart,
  };
}