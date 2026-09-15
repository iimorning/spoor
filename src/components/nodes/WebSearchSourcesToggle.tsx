import React from 'react';
import { useTranslation } from 'react-i18next';
import { Layers2 } from 'lucide-react';

interface WebSearchSourcesToggleProps {
  count: number;
  collapsed: boolean;
  onToggle?: () => void;
  /** Extra classes for dark / glass note shells */
  className?: string;
  /** Override tooltip / aria when reusing for Ask thread stacking etc. */
  collapseTitle?: string;
  expandTitle?: string;
  /** Hide when count is below this (default 2 for web sources; Ask/theme use 1). */
  minCount?: number;
}

/** Compact stack/expand control for web-search / Ask / theme card piles. */
export function WebSearchSourcesToggle({
  count,
  collapsed,
  onToggle,
  className = '',
  collapseTitle,
  expandTitle,
  minCount = 2,
}: WebSearchSourcesToggleProps) {
  const { t } = useTranslation();
  if (count < minCount || !onToggle) return null;

  const title = collapsed
    ? expandTitle ?? t('nodes.expand_web_sources')
    : collapseTitle ?? t('nodes.collapse_web_sources');

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={title}
      aria-label={title}
      data-testid="stack-cards-toggle"
      className={`absolute top-3 right-3 z-20 flex items-center gap-1 rounded-full border border-[#E6E4DF] bg-white/90 px-2 py-1 text-[10px] font-sans font-medium text-[#5a5a54] shadow-sm hover:border-[#C2410C]/50 hover:text-[#C2410C] transition-colors ${className}`}
    >
      <Layers2 className="h-3.5 w-3.5" aria-hidden />
      <span className="tabular-nums text-[#a8a6a0]">{count}</span>
    </button>
  );
}
