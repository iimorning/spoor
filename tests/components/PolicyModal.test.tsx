/**
 * Sanity test for PolicyModal — confirms the modal mounts, the chrome
 * is reachable when open, and the close button / backdrop / panel-click
 * behaviours behave as documented. The modal renders via createPortal
 * to document.body, so we query document.body directly for portaled
 * elements rather than the RTL `container`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'policy.title_tos': 'Terms of Service',
        'policy.title_privacy': 'Privacy Policy',
        'policy.close': 'Close',
      };
      return dict[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { PolicyModal } from '../../src/components/PolicyModal';

function modalRoot(): HTMLElement {
  return document.querySelector('.policy-modal') as HTMLElement;
}

describe('PolicyModal', () => {
  // RTL by default does not auto-cleanup in vitest; explicit cleanup
  // also removes any portaled children still attached to document.body.
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when kind is null', () => {
    render(<PolicyModal kind={null} onClose={() => {}} />);
    expect(document.querySelector('.policy-modal')).toBeNull();
  });

  it('renders the modal chrome when kind is "tos"', () => {
    render(<PolicyModal kind="tos" onClose={() => {}} />);
    expect(document.querySelector('.policy-modal')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Terms of Service')).toBeTruthy();
  });

  it('renders the modal chrome when kind is "privacy"', () => {
    render(<PolicyModal kind="privacy" onClose={() => {}} />);
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
  });

  it('invokes onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PolicyModal kind="tos" onClose={onClose} />);
    const backdrop = modalRoot();
    expect(backdrop).toBeTruthy();
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke onClose when the panel itself is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PolicyModal kind="tos" onClose={onClose} />);
    const panel = document.querySelector('.policy-modal__panel');
    expect(panel).toBeTruthy();
    if (panel) {
      await user.click(panel);
      expect(onClose).not.toHaveBeenCalled();
    }
  });

  it('renders the markdown body (or error-boundary fallback) when open', () => {
    render(<PolicyModal kind="tos" onClose={() => {}} />);
    const body = document.querySelector('.policy-modal__body');
    expect(body).toBeTruthy();
    expect(body?.children.length ?? 0).toBeGreaterThan(0);
  });
});

