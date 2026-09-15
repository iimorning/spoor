import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingGestureDemo } from '../../src/onboarding/OnboardingGestureDemo';

describe('OnboardingGestureDemo', () => {
  it('renders the looping marquee cartoon', () => {
    render(<OnboardingGestureDemo kind="marquee" />);
    expect(screen.getByTestId('onboarding-demo-marquee')).toBeInTheDocument();
  });

  it('renders the looping middle-button pan cartoon', () => {
    render(<OnboardingGestureDemo kind="pan" />);
    expect(screen.getByTestId('onboarding-demo-pan')).toBeInTheDocument();
  });

  it('renders the drag-into-room cartoon', () => {
    render(<OnboardingGestureDemo kind="drag-in" />);
    expect(screen.getByTestId('onboarding-demo-drag-in')).toBeInTheDocument();
  });
});
