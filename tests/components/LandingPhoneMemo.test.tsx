import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { LandingPhoneMemo } from '../../src/components/landing/LandingPhoneMemo';

function renderPhone() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LandingPhoneMemo />
    </I18nextProvider>,
  );
}

describe('LandingPhoneMemo', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows list and editor phone shots in English', () => {
    renderPhone();
    expect(screen.getByRole('heading', { name: /Open the record/ })).toBeInTheDocument();
    expect(screen.getByTestId('lp-phone-memo-list').querySelector('img')?.getAttribute('src') ?? '').toMatch(
      /phone-memo-list-en/,
    );
    expect(screen.getByTestId('lp-phone-memo-edit').querySelector('img')?.getAttribute('src') ?? '').toMatch(
      /phone-memo-edit-en/,
    );
    expect(screen.getByText('Memo list — open your records on the phone')).toBeInTheDocument();
    expect(screen.getByText('Tap a memo to keep writing')).toBeInTheDocument();
  });

  it('switches both screenshots with the Chinese locale', async () => {
    await i18n.changeLanguage('zh');
    renderPhone();
    expect(screen.getByRole('heading', { name: /在路上记下的/ })).toBeInTheDocument();
    expect(screen.getByTestId('lp-phone-memo-list').querySelector('img')?.getAttribute('src') ?? '').toMatch(
      /phone-memo-list-zh/,
    );
    expect(screen.getByTestId('lp-phone-memo-edit').querySelector('img')?.getAttribute('src') ?? '').toMatch(
      /phone-memo-edit-zh/,
    );
  });
});
