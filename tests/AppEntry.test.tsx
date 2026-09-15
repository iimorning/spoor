import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppEntry from '../src/AppEntry';

const useAdaptiveLayoutMock = vi.hoisted(() => vi.fn());

vi.mock('../src/hooks/useAdaptiveLayout', () => ({
  useAdaptiveLayout: useAdaptiveLayoutMock,
}));

vi.mock('../src/utils/isTauriRuntime', () => ({
  isTauriRuntime: () => false,
}));

vi.mock('../src/DesktopAppEntry', () => ({
  default: () => <div data-testid="desktop-entry" />,
}));

vi.mock('../src/PhonePocketApp', () => ({
  default: () => <div data-testid="phone-entry" />,
}));

describe('AppEntry', () => {
  beforeEach(() => {
    useAdaptiveLayoutMock.mockReset();
  });

  it('loads the lightweight pocket entry on phones', async () => {
    useAdaptiveLayoutMock.mockReturnValue({ phone: true, compact: true, touchChrome: true });
    render(<AppEntry />);
    expect(await screen.findByTestId('phone-entry')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-entry')).toBeNull();
  });

  it('loads the desktop workspace entry otherwise', async () => {
    useAdaptiveLayoutMock.mockReturnValue({ phone: false, compact: false, touchChrome: false });
    render(<AppEntry />);
    expect(await screen.findByTestId('desktop-entry')).toBeInTheDocument();
    expect(screen.queryByTestId('phone-entry')).toBeNull();
  });
});
