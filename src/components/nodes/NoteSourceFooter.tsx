import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { openExternalUrl } from '../../utils/openExternal';
import { sourceHostLabel } from '../../utils/noteSourceHref';

/** Bottom bar on a note: open the source page without putting a raw URL in the body. */
export function NoteSourceFooter({ href }: { href: string }) {
  const { t } = useTranslation();
  const host = sourceHostLabel(href);
  return (
    <div
      data-testid="note-source-footer"
      className="mt-2 shrink-0 border-t border-[#E6E4DF] pt-2 flex items-center gap-2 min-w-0"
    >
      <span className="min-w-0 flex-1 truncate text-[10px] font-sans text-[#8c8a84]" title={href}>
        {host}
      </span>
      <button
        type="button"
        data-testid="note-source-open"
        onClick={(e) => {
          e.stopPropagation();
          void openExternalUrl(href).catch((err) =>
            console.error('[Spoor] open note source failed', err),
          );
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={href}
        aria-label={t('nodes.webpage_open_source')}
        className="shrink-0 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        <span>{t('nodes.webpage_open_source_short')}</span>
      </button>
    </div>
  );
}
