import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AddToHomeScreenPanel } from '../../src/components/AddToHomeScreenPanel';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';

const layoutMock = vi.hoisted(() => ({ phone: true, touchChrome: true, compact: false }));
const pwaMock = vi.hoisted(() => ({
  canNativePrompt: false,
  isInstalled: false,
  isIos: true,
  promptInstall: vi.fn(async () => true),
}));
const isTauriRuntimeMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('../../src/hooks/useAdaptiveLayout', () => ({
  useAdaptiveLayout: () => layoutMock,
}));
vi.mock('../../src/hooks/usePwaInstall', () => ({
  usePwaInstall: () => pwaMock,
}));
vi.mock('../../src/utils/isTauriRuntime', () => ({
  isTauriRuntime: isTauriRuntimeMock,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh' },
  }),
}));
vi.mock('lucide-react', () => ({
  Smartphone: (props: Record<string, unknown>) => React.createElement('svg', { 'data-testid': 'icon-smartphone', ...props }),
}));

describe('AddToHomeScreenPanel', () => {
  beforeEach(() => {
    layoutMock.phone = true;
    pwaMock.isInstalled = false;
    pwaMock.canNativePrompt = false;
    pwaMock.isIos = true;
    isTauriRuntimeMock.mockReturnValue(false);
  });

  it('shows the add-to-home button on phone web', () => {
    render(
      <AppDialogProvider>
        <AddToHomeScreenPanel variant="phone" />
      </AppDialogProvider>,
    );
    expect(screen.getByTestId('settings-add-to-home')).toBeInTheDocument();
  });

  it('opens iOS instructions when native install is unavailable', async () => {
    const user = userEvent.setup();
    render(
      <AppDialogProvider>
        <AddToHomeScreenPanel variant="phone" />
      </AppDialogProvider>,
    );
    await user.click(screen.getByTestId('settings-add-to-home'));
    expect(await screen.findByText('settings.add_to_home_ios')).toBeInTheDocument();
  });

  it('hides when already installed', () => {
    pwaMock.isInstalled = true;
    render(
      <AppDialogProvider>
        <AddToHomeScreenPanel variant="phone" />
      </AppDialogProvider>,
    );
    expect(screen.queryByTestId('settings-add-to-home')).not.toBeInTheDocument();
  });
});
