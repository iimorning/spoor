import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Loader2, X } from 'lucide-react';
import { db } from '../db';
import { tryParseBookContent } from '../utils/bookPayload';
import { BookNode } from './nodes/BookNode';

export type BookFullscreenProps = {
  nodeId: string;
  onClose: () => void;
  onExtractSelectionToCard?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  onAskAboutSelection?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  onExpandSelection?: (quote: string, sourceLabel?: string) => void;
  isExpanding?: boolean;
};

export function BookFullscreen({
  nodeId,
  onClose,
  onExtractSelectionToCard,
  onAskAboutSelection,
  onExpandSelection,
  isExpanding = false,
}: BookFullscreenProps) {
  const { t } = useTranslation();
  const node = useLiveQuery(async () => {
    const row = await db.nodes.get(nodeId);
    return row ?? null;
  }, [nodeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (node === null) onClose();
  }, [node, onClose]);

  if (node === undefined) {
    return (
      <div
        className="fixed inset-0 z-[125] flex items-center justify-center bg-[#FAF9F6]"
        data-testid="book-fullscreen"
        role="dialog"
        aria-modal="true"
      >
        <Loader2 className="h-6 w-6 animate-spin text-[#C2410C]" />
      </div>
    );
  }

  if (!node || node.type !== 'book') return null;

  const book = tryParseBookContent(node.content);
  const title = book?.title?.trim() || node.description?.trim() || t('nodes.book');
  const formatBadge = book?.format === 'pdf' ? 'PDF' : book?.format === 'epub' ? 'EPUB' : null;

  return (
    <div
      className="fixed inset-0 z-[125] flex flex-col bg-[#FAF9F6] paper-texture"
      data-testid="book-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="h-14 shrink-0 bg-white/90 backdrop-blur-md border-b border-[#E6E4DF] flex items-center justify-between px-4 z-10 gap-3">
        <span className="min-w-0 flex items-center gap-2 text-xs font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
          <BookOpen className="w-4 h-4 text-[#C2410C] shrink-0" />
          {t('nodes.book')}
          {formatBadge ? (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#F4F1ED] text-[#8c8a84] normal-case tracking-normal">
              {formatBadge}
            </span>
          ) : null}
          <span className="min-w-0 truncate font-serif text-sm font-semibold normal-case tracking-normal text-[#2c2c28]">
            {title}
          </span>
        </span>
        <button
          type="button"
          data-testid="book-fullscreen-close"
          onClick={onClose}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[#E6E4DF] bg-white text-[#5a5a54] shadow-sm hover:bg-[#C2410C] hover:text-white hover:border-[#C2410C] transition-colors shrink-0"
          title={t('nodes.book_close')}
          aria-label={t('nodes.book_close')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <BookNode
          node={node}
          editingNodeId={null}
          setEditingNodeId={() => {}}
          layout="immersive"
          onExtractSelectionToCard={onExtractSelectionToCard}
          onAskAboutSelection={onAskAboutSelection}
          onExpandSelection={onExpandSelection}
          isExpanding={isExpanding}
        />
      </div>
    </div>
  );
}
