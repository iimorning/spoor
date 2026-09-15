import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { PhoneSettingsModal } from '../../src/components/PhoneSettingsModal';
import { NOTE_CJK_STORAGE_KEY, type NoteCjkId } from '../../src/hooks/useNoteCjk';

const noteCjkMock = vi.hoisted(() => ({
  id: 'system' as NoteCjkId,
  setNoteCjk: vi.fn(),
}));

vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/contexts/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({ user: null }),
  };
});

vi.mock('../../src/hooks/useNoteCjk', async () => {
  const actual = await vi.importActual<typeof import('../../src/hooks/useNoteCjk')>(
    '../../src/hooks/useNoteCjk',
  );
  return {
    ...actual,
    useNoteCjk: () => noteCjkMock,
  };
});

vi.mock('../../src/components/CloudAccountPanel', () => ({
  CloudAccountPanel: () => React.createElement('div', { 'data-testid': 'cloud-panel' }),
}));

vi.mock('../../src/components/AddToHomeScreenPanel', () => ({
  AddToHomeScreenPanel: () => React.createElement('div', { 'data-testid': 'add-to-home-panel' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => React.createElement('svg', { 'data-testid': 'icon-x', ...props }),
}));

describe('PhoneSettingsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    noteCjkMock.id = 'system';
    noteCjkMock.setNoteCjk.mockReset();
  });

  it('renders the memo font picker with system default option', () => {
    render(<PhoneSettingsModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('phone-settings-note-cjk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.note_cjk_system' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'settings.note_cjk_zhuque' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switches the memo font when a chip is tapped', async () => {
    render(<PhoneSettingsModal isOpen onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'settings.note_cjk_system' }));
    expect(noteCjkMock.setNoteCjk).toHaveBeenCalledWith('system');
  });

  it('persists font choice through the shared note CJK hook', () => {
    localStorage.setItem(NOTE_CJK_STORAGE_KEY, 'wenkai');
    noteCjkMock.id = 'wenkai';
    render(<PhoneSettingsModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'settings.note_cjk_wenkai' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
