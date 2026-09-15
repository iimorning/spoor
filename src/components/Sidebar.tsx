import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Bot, Settings } from 'lucide-react';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';

export interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  setIsSettingsOpen: (open: boolean) => void;
  /** Phone memos waiting in archive; shown as a badge on the archive control. */
  pocketCount?: number;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Minimal left rail: Archive / Agents / Settings.
 * Clicking an active panel returns to the canvas.
 */
export function Sidebar({
  activeTab,
  setActiveTab,
  setIsSettingsOpen,
  pocketCount = 0,
}: SidebarProps) {
  const { t } = useTranslation();
  const { touchChrome } = useAdaptiveLayout();

  const go = (tab: 'archive' | 'agents') => {
    setActiveTab(activeTab === tab ? 'personal' : tab);
  };

  useEffect(() => {
    if (activeTab !== 'archive' && activeTab !== 'agents') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setActiveTab('personal');
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, setActiveTab]);

  const iconBtn = touchChrome
    ? 'w-11 h-11 flex items-center justify-center rounded-full transition-colors border border-transparent outline-none focus-visible:outline-none'
    : 'w-10 h-10 flex items-center justify-center rounded-full transition-colors border border-transparent outline-none focus-visible:outline-none';
  const sidebarPos = touchChrome
    ? 'fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex flex-row items-center gap-2 pointer-events-auto bg-white/70 backdrop-blur-md rounded-full px-2 py-1 border border-[#E6E4DF] shadow-sm'
    : 'fixed left-1 top-1/2 -translate-y-1/2 z-50 flex flex-col items-center gap-2 pointer-events-auto';

  const pressed = (tab: string) =>
    `${iconBtn} ${
      activeTab === tab
        ? 'bg-white text-[#C2410C] border-[#E6E4DF] shadow-md'
        : 'text-[#5a5a54] hover:text-[#C2410C] hover:bg-white/90 hover:border-[#E6E4DF] hover:shadow-sm'
    }`;

  const archiveLabel =
    pocketCount > 0
      ? `${t('sidebar.archive')} · ${t('sidebar.archive_waiting', { count: pocketCount })}`
      : t('sidebar.archive');

  return (
    <aside
      data-testid="side-rail"
      className={sidebarPos}
      aria-label={t('sidebar.rail_label')}
    >
      <button
        type="button"
        data-testid="rail-archive"
        onClick={(e) => {
          go('archive');
          e.currentTarget.blur();
        }}
        title={archiveLabel}
        aria-label={archiveLabel}
        aria-pressed={activeTab === 'archive'}
        className={`relative overflow-visible ${pressed('archive')}`}
      >
        <Archive className="w-5 h-5" />
        {pocketCount > 0 ? (
          <span
            data-testid="rail-archive-badge"
            aria-hidden
            className="absolute -top-0.5 -right-0.5 min-w-[0.875rem] h-[0.875rem] px-0.5 rounded-full bg-[#C2410C] text-white text-[9px] leading-[0.875rem] font-mono font-bold text-center shadow-[0_0_0_1.5px_#FAF9F6]"
          >
            {pocketCount > 99 ? '99+' : pocketCount}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        data-testid="rail-agents"
        onClick={(e) => {
          go('agents');
          e.currentTarget.blur();
        }}
        title={t('sidebar.agents')}
        aria-label={t('sidebar.agents')}
        aria-pressed={activeTab === 'agents'}
        className={pressed('agents')}
      >
        <Bot className="w-5 h-5" />
      </button>
      <button
        type="button"
        data-testid="rail-settings"
        onClick={(e) => {
          setIsSettingsOpen(true);
          e.currentTarget.blur();
        }}
        title={t('sidebar.settings')}
        aria-label={t('sidebar.settings')}
        className={`${iconBtn} text-[#5a5a54] hover:text-[#C2410C] hover:bg-white/90 hover:border-[#E6E4DF] hover:shadow-sm group/settings`}
      >
        <Settings className="w-5 h-5 transition-transform group-hover/settings:rotate-45" />
      </button>
    </aside>
  );
}
