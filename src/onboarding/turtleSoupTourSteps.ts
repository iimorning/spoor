/**
 * Turtle-Soup canvas onboarding tour.
 *
 * Mirrors `intuitionPumpTourSteps.ts` — fires once when the user lands on a
 * canvas stamped from the official turtle-soup template, walking them through
 * the rules card and the host agent. The "Start a round"
 * note was removed from the template in favor of this overlay.
 */

import type { OnboardingStep } from './useOnboarding';

export const TURTLE_SOUP_TOUR_STEPS: OnboardingStep[] = [
  {
    id: 'turtle-soup-howto',
    targetTestId: 'template-node-theme-howto',
    placement: 'right',
    copy: {
      titleKey: 'onboarding.turtle_soup.step1.title',
      bodyKey: 'onboarding.turtle_soup.step1.body',
    },
  },
  {
    id: 'turtle-soup-host',
    targetTestId: 'template-node-agent-host',
    placement: 'right',
    copy: {
      titleKey: 'onboarding.turtle_soup.step2.title',
      bodyKey: 'onboarding.turtle_soup.step2.body',
    },
  },
  {
    id: 'turtle-soup-chat',
    targetTestId: 'template-node-agent-host',
    placement: 'right',
    copy: {
      titleKey: 'onboarding.turtle_soup.step3.title',
      bodyKey: 'onboarding.turtle_soup.step3.body',
    },
    nextLabelKey: 'onboarding.cta_done',
  },
];

export function resolveTurtleSoupTourSteps(): OnboardingStep[] {
  return TURTLE_SOUP_TOUR_STEPS;
}