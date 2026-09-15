/**
 * Intuition-Pump canvas onboarding tour.
 *
 * Mirrors `tourSteps.ts` (the global first-time tour) but only fires when
 * the user lands on a canvas stamped from the official intuition-pump
 * template. The "Start one" note was removed from that template in favor of
 * this overlay — it shows the user where to click and what to expect,
 * without cluttering the canvas with a disposable note.
 *
 * Targets use the `template-node-{templateKey}` testid stamped by
 * `DraggableNode` from `CanvasNode.templateKey`.
 */

import type { OnboardingStep } from './useOnboarding';

export const INTUITION_PUMP_TOUR_STEPS: OnboardingStep[] = [
  {
    id: 'intuition-pump-howto',
    targetTestId: 'template-node-theme-howto',
    placement: 'right',
    copy: {
      titleKey: 'onboarding.intuition_pump.step1.title',
      bodyKey: 'onboarding.intuition_pump.step1.body',
    },
  },
  {
    id: 'intuition-pump-host',
    targetTestId: 'template-node-agent-host',
    placement: 'right',
    copy: {
      titleKey: 'onboarding.intuition_pump.step2.title',
      bodyKey: 'onboarding.intuition_pump.step2.body',
    },
  },
  {
    id: 'intuition-pump-chat',
    targetTestId: 'template-node-agent-host',
    placement: 'right',
    copy: {
      titleKey: 'onboarding.intuition_pump.step3.title',
      bodyKey: 'onboarding.intuition_pump.step3.body',
    },
    nextLabelKey: 'onboarding.cta_done',
  },
];

export function resolveIntuitionPumpTourSteps(): OnboardingStep[] {
  // Reserved for future per-locale or per-variant steps. v1 returns the
  // static list.
  return INTUITION_PUMP_TOUR_STEPS;
}