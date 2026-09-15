import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'policy.title_privacy': 'Privacy Policy',
        'policy.title_tos': 'Terms of Service',
        'policy.title_aup': 'Acceptable Use Policy',
        'policy.lang_toggle': 'Document language',
        'policy.back_home': 'Back to home',
        'landing.footer_copy': '© Spoor.',
        'landing.policy.tos': 'Terms',
        'landing.policy.aup': 'Acceptable use',
        'landing.policy.privacy': 'Privacy',
        'landing.policy.report': 'Report content',
        'landing.footer_contact': 'Contact',
      };
      return dict[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { PolicyPage } from '../../src/components/PolicyPage';

describe('PolicyPage', () => {
  it('renders the full privacy policy on /privacy route page', () => {
    render(<PolicyPage kind="privacy" />);
    expect(screen.getByRole('article', { name: 'Privacy Policy' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy();
    expect(document.querySelector('.policy-page__body')?.textContent?.length ?? 0).toBeGreaterThan(200);
  });

  it('renders the full terms of service page', () => {
    render(<PolicyPage kind="tos" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeTruthy();
    expect(document.querySelector('.policy-page__body')?.textContent?.length ?? 0).toBeGreaterThan(200);
  });

  it('renders the acceptable use policy with the six prohibited categories', () => {
    render(<PolicyPage kind="aup" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Acceptable Use Policy' })).toBeTruthy();
    const text = document.querySelector('.policy-page__body')?.textContent ?? '';
    expect(text).toMatch(/Pornography \/ NSFW/i);
    expect(text).toMatch(/Violence \/ gore/i);
    expect(text).toMatch(/Hate speech/i);
    expect(text).toMatch(/w978109720\+aup@gmail\.com/);
  });
});
