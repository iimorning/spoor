/**
 * Interactive landing demo: one ordinary note, two voices, add-a-persona slot.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { LandingRolesDemo } from '../../src/components/landing/LandingRolesDemo';

function renderDemo() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LandingRolesDemo />
    </I18nextProvider>,
  );
}

describe('LandingRolesDemo', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('keeps the shared note visible and starts on the cautious insight', () => {
    renderDemo();
    expect(screen.getByTestId('lp-roles-source')).toHaveTextContent(
      'A big company offered a stable job',
    );
    expect(screen.getByTestId('lp-roles-insight')).toHaveTextContent(
      'Take the job. Not forever',
    );
    expect(screen.getByTestId('lp-roles-persona-cautious')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('swaps the insight when the other persona is selected, without changing the source', async () => {
    const user = userEvent.setup();
    renderDemo();
    const sourceBefore = screen.getByTestId('lp-roles-source').textContent;
    await user.click(screen.getByTestId('lp-roles-persona-leap'));
    expect(screen.getByTestId('lp-roles-persona-leap')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('lp-roles-insight')).toHaveTextContent(
      'What you’re afraid of isn’t failing',
    );
    expect(screen.getByTestId('lp-roles-source').textContent).toBe(sourceBefore);
  });

  it('shows a non-interactive add-persona slot', () => {
    renderDemo();
    const add = screen.getByTestId('lp-roles-add-persona');
    expect(add).toHaveTextContent('Add a persona');
    expect(add.tagName).not.toBe('BUTTON');
  });

  it('moves between personas with arrow keys', async () => {
    const user = userEvent.setup();
    renderDemo();
    screen.getByTestId('lp-roles-persona-cautious').focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('lp-roles-persona-leap')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('lp-roles-insight')).toHaveTextContent(
      'Your friends are asking now',
    );
  });
});
