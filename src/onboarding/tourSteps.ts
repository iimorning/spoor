/**
 * Global first-run tour — canvas-first interactive loop.
 *
 * Order: work room → drag material in → chat + send → drag reply → compose essay.
 * Gated steps auto-advance via `useOnboardingGates` in App.tsx.
 */

import type { OnboardingStep } from './useOnboarding';

export const TOUR_STEPS: OnboardingStep[] = [
  {
    id: 'work-room',
    targetTestId: 'canvas-workspace-host',
    highlight: 'work-zone',
    placement: 'bottom',
    requireTab: 'personal',
    gate: 'manual',
    copy: {
      titleKey: 'onboarding.loop.step1.title',
      bodyKey: 'onboarding.loop.step1.body',
    },
  },
  {
    id: 'move-material',
    targetTestId: 'canvas-workspace-host',
    highlight: 'work-zone-and-outside',
    tooltipAnchor: 'outside-materials',
    placement: 'left',
    placementAlign: 'end',
    requireTab: 'personal',
    gate: 'material-moved',
    canvasArrow: 'drag-in',
    copy: {
      titleKey: 'onboarding.loop.step2.title',
      bodyKey: 'onboarding.loop.step2.body',
    },
  },
  {
    id: 'open-chat',
    targetTestId: 'canvas-chat-panel',
    placement: 'left',
    requireTab: 'personal',
    gate: 'chat-sent',
    copy: {
      titleKey: 'onboarding.loop.step3.title',
      bodyKey: 'onboarding.loop.step3.body',
    },
  },
  {
    id: 'excerpt-reply',
    targetTestId: 'canvas-chat-panel',
    highlight: 'chat-reply-drag-handle',
    placement: 'left',
    requireTab: 'personal',
    gate: 'excerpt-created',
    copy: {
      titleKey: 'onboarding.loop.step4.title',
      bodyKey: 'onboarding.loop.step4.body',
      bodyRich: true,
    },
  },
  {
    id: 'compose-essay',
    targetTestId: 'canvas-workspace-host',
    placement: 'bottom',
    requireTab: 'personal',
    gate: 'manual',
    demo: 'marquee',
    nextLabelKey: 'onboarding.cta_done',
    copy: {
      titleKey: 'onboarding.loop.step5.title',
      bodyKey: 'onboarding.loop.step5.body',
    },
  },
];

export function resolveTourSteps(): OnboardingStep[] {
  return TOUR_STEPS;
}
