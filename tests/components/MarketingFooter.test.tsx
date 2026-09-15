import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { email?: string }) => {
      const dict: Record<string, string> = {
        'landing.footer_copy': '© Spoor.',
        'landing.policy.tos': 'Terms',
        'landing.policy.aup': 'Acceptable use',
        'landing.policy.privacy': 'Privacy',
        'landing.policy.report': 'Report content',
        'landing.footer_contact': `Contact: ${opts?.email ?? ''}`,
      };
      return dict[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { MarketingFooter } from '../../src/components/MarketingFooter';
import { SUPPORT_EMAIL } from '../../src/constants/siteLegal';

describe('MarketingFooter', () => {
  it('shows terms, privacy, and support email links', () => {
    render(<MarketingFooter />);
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Acceptable use' })).toHaveAttribute('href', '/aup');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Report content' })).toHaveAttribute('href', '/report');
    const contact = screen.getByRole('link', { name: `Contact: ${SUPPORT_EMAIL}` });
    expect(contact).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
  });
});
