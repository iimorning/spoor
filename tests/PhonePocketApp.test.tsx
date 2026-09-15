import type React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PhonePocketApp from '../src/PhonePocketApp';

vi.mock('../src/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ configured: true, session: { user: { id: 'u1' } } }),
}));

vi.mock('../src/components/PocketView', () => ({
  PocketView: ({
    onOpenLogin,
    accountSignedIn,
  }: {
    onOpenLogin?: () => void;
    accountSignedIn?: boolean;
  }) => (
    <button type="button" data-signed-in={accountSignedIn} onClick={onOpenLogin}>
      pocket
    </button>
  ),
}));

vi.mock('../src/components/PhoneSettingsModal', () => ({
  PhoneSettingsModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="phone-settings" /> : null,
}));

describe('PhonePocketApp', () => {
  it('opens lightweight account settings from the pocket header', async () => {
    render(<PhonePocketApp />);
    const button = screen.getByRole('button', { name: 'pocket' });
    expect(button).toHaveAttribute('data-signed-in', 'true');
    await userEvent.click(button);
    expect(await screen.findByTestId('phone-settings')).toBeInTheDocument();
  });
});
