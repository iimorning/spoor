import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingCanvasArrow } from '../../src/onboarding/OnboardingCanvasArrow';

describe('OnboardingCanvasArrow', () => {
  it('renders an animated arrow between two screen rects', () => {
    render(
      <OnboardingCanvasArrow
        from={new DOMRect(820, 180, 280, 420)}
        to={new DOMRect(120, 160, 520, 360)}
      />,
    );
    expect(screen.getByTestId('onboarding-canvas-arrow')).toBeInTheDocument();
  });
});
