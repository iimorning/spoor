import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Sidebar } from '../../src/components/Sidebar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', () => {
  const make = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    Settings: make('Settings'),
    Archive: make('Archive'),
    Bot: make('Bot'),
  };
});

function makeProps(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return {
    activeTab: 'personal',
    setActiveTab: vi.fn(),
    setIsSettingsOpen: vi.fn(),
    ...overrides,
  };
}

function renderSidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const merged = makeProps(props);
  return { ...render(<Sidebar {...merged} />), props: merged };
}

describe('Sidebar (icon rail)', () => {
  it('renders archive, agents, and settings icons', () => {
    renderSidebar();
    expect(screen.getByTestId('side-rail')).toBeInTheDocument();
    expect(screen.getByTestId('icon-Archive')).toBeInTheDocument();
    expect(screen.getByTestId('icon-Bot')).toBeInTheDocument();
    expect(screen.getByTestId('icon-Settings')).toBeInTheDocument();
    expect(screen.queryByTestId('rail-pocket')).not.toBeInTheDocument();
    expect(screen.queryByTestId('icon-BookOpen')).not.toBeInTheDocument();
  });

  it('does not show canvas / profile chrome', () => {
    renderSidebar();
    expect(screen.queryByText('sidebar.personal')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Curator Profile')).not.toBeInTheDocument();
  });

  it('clicking archive calls setActiveTab("archive") when not active', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    renderSidebar({ setActiveTab, activeTab: 'personal' });
    await user.click(screen.getByTestId('rail-archive'));
    expect(setActiveTab).toHaveBeenCalledWith('archive');
  });

  it('clicking archive again returns to canvas (personal)', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    renderSidebar({ setActiveTab, activeTab: 'archive' });
    await user.click(screen.getByTestId('rail-archive'));
    expect(setActiveTab).toHaveBeenCalledWith('personal');
  });

  it('clicking agents calls setActiveTab("agents")', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    renderSidebar({ setActiveTab, activeTab: 'personal' });
    await user.click(screen.getByTestId('rail-agents'));
    expect(setActiveTab).toHaveBeenCalledWith('agents');
  });

  it('clicking agents again returns to canvas', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    renderSidebar({ setActiveTab, activeTab: 'agents' });
    await user.click(screen.getByTestId('rail-agents'));
    expect(setActiveTab).toHaveBeenCalledWith('personal');
  });

  it('marks archive pressed when active', () => {
    renderSidebar({ activeTab: 'archive' });
    expect(screen.getByTestId('rail-archive')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('rail-agents')).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking settings opens settings', async () => {
    const user = userEvent.setup();
    const setIsSettingsOpen = vi.fn();
    renderSidebar({ setIsSettingsOpen });
    await user.click(screen.getByTestId('rail-settings'));
    expect(setIsSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('settings button has i18n title', () => {
    renderSidebar();
    expect(screen.getByTestId('rail-settings')).toHaveAttribute('title', 'sidebar.settings');
  });

  it('Escape on archive or agents returns to canvas', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    const { rerender } = render(
      <Sidebar {...makeProps({ setActiveTab, activeTab: 'archive' })} />,
    );
    await user.keyboard('{Escape}');
    expect(setActiveTab).toHaveBeenCalledWith('personal');

    setActiveTab.mockClear();
    rerender(<Sidebar {...makeProps({ setActiveTab, activeTab: 'agents' })} />);
    await user.keyboard('{Escape}');
    expect(setActiveTab).toHaveBeenCalledWith('personal');

    setActiveTab.mockClear();
    rerender(<Sidebar {...makeProps({ setActiveTab, activeTab: 'personal' })} />);
    await user.keyboard('{Escape}');
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('Escape while typing in an input does not leave archive', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    render(
      <>
        <Sidebar {...makeProps({ setActiveTab, activeTab: 'archive' })} />
        <input data-testid="typing-target" />
      </>,
    );
    await user.click(screen.getByTestId('typing-target'));
    await user.keyboard('{Escape}');
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('Escape returning to canvas blurs the rail button', async () => {
    const user = userEvent.setup();
    renderSidebar({ activeTab: 'agents' });
    const btn = screen.getByTestId('rail-agents');
    btn.focus();
    expect(btn).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(btn).not.toHaveFocus();
  });

  it('shows a waiting-memo badge on archive, not a separate pocket button', () => {
    renderSidebar({ pocketCount: 3 });
    expect(screen.queryByTestId('rail-pocket')).not.toBeInTheDocument();
    expect(screen.getByTestId('rail-archive-badge')).toHaveTextContent('3');
    expect(screen.getByTestId('rail-archive')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('sidebar.archive_waiting'),
    );
  });

  it('hides the archive badge when no phone memos are waiting', () => {
    renderSidebar({ pocketCount: 0 });
    expect(screen.queryByTestId('rail-archive-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('rail-archive')).toHaveAttribute('aria-label', 'sidebar.archive');
  });

  it('clicking a rail button does not leave it focused', async () => {
    const user = userEvent.setup();
    renderSidebar({ activeTab: 'personal' });
    const btn = screen.getByTestId('rail-agents');
    await user.click(btn);
    expect(btn).not.toHaveFocus();
  });
});
