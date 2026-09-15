import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { REPORT_EMAIL } from '../../src/constants/siteLegal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'report.title': 'Report a content violation',
        'report.lede': 'Use this form for AUP issues.',
        'report.mailbox_label': 'Dedicated report mailbox:',
        'report.read_aup': 'Read the Acceptable Use Policy',
        'report.field_email': 'Your email',
        'report.field_url': 'URL',
        'report.field_categories': 'Categories',
        'report.field_details': 'What happened',
        'report.submit': 'Open report email',
        'report.mail_subject': '[Spoor AUP] Content report',
        'report.category_nsfw': 'Pornography / NSFW',
        'report.category_violence': 'Violence / gore',
        'report.category_hate': 'Hate speech',
        'report.category_csam': 'Child-unsafe content',
        'report.category_deepfake': 'Deepfake / impersonation',
        'report.category_ip': 'Copyright / trademark',
        'report.category_other': 'Other',
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

import { ReportPage } from '../../src/components/ReportPage';

describe('ReportPage', () => {
  it('shows the dedicated AUP mailbox and category checkboxes', () => {
    render(<ReportPage />);
    expect(screen.getByRole('heading', { name: 'Report a content violation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: REPORT_EMAIL })).toHaveAttribute(
      'href',
      `mailto:${REPORT_EMAIL}`,
    );
    expect(screen.getByText('Pornography / NSFW')).toBeTruthy();
    expect(screen.getByText('Violence / gore')).toBeTruthy();
    expect(screen.getByText('Hate speech')).toBeTruthy();
  });
});
